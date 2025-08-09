#!/usr/bin/env node

/**
 * inst.js
 * A robust CLI tool for managing life's instructions.
 *
 * This version incorporates a main execution function, pre-parsing for command
 * suggestions, a global loading indicator, a dedicated welcome screen, a
 * fully custom failure handler, a custom help UI, and success feedback system.
 * Final Version
 */

// --- Core Node.js and Third-Party Modules ---
import chalk from "chalk";
import chalkAnimation from "chalk-animation";
import { execSync } from "child_process";
import * as chrono from "chrono-node";
import fs from "fs";
import { readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import readline from "readline";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// --- Configuration and Constants ---
const CONFIG = {
  DATA_DIR: path.join(os.homedir(), ".inst"),
  DATA_PATH: path.join(os.homedir(), ".inst", "inst.json"),
  UNDO_STACK_FILE: path.join(os.homedir(), ".inst", "undoInst.json"),
  REDO_STACK_FILE: path.join(os.homedir(), ".inst", "redoInst.json"),
  MAX_UNDO_REDO_STATES: 10,
  PRIORITY_ORDER: { high: 1, medium: 2, low: 3, normal: 4 },
  STATUS_SYMBOLS: {
    completed: chalk.green("✔"),
    processing: chalk.blue("⚙"),
    paused: chalk.yellow("⏸"),
    pending: chalk.white("…"),
  },
};

const commandExamples = {
  add: 'inst add --source "Personal" --instruction "Buy milk" --priority "high"',
  show: 'inst show --status "completed"',
  list: "inst list --month August --year 2025",
  edit: 'inst edit --id 12 --priority "low"',
  mark: 'inst mark --id 12 --status "completed"',
  delete: "inst delete --id 15",
  recover: "inst recover --id 15",
  reset: "inst reset",
  undo: "inst undo",
  redo: "inst redo",
  export: `inst export --format pdf --all`,
  total: "inst total --month Aug --all",
  manual: "inst manual --open",
};

// A map of options to their aliases for the failure handler
const optionAliases = {
  source: "s",
  instruction: "i",
  priority: "p",
  deadline: "dl",
  id: "i",
  status: "st",
};

// A map of options to their available choices for richer feedback
const optionChoices = {
  priority: ["high", "medium", "low", "normal"],
  status: Object.keys(CONFIG.STATUS_SYMBOLS),
  format: ["pdf", "csv"],
};

// A list of all valid options for typo suggestions
const allValidOptions = [
  "source",
  "instruction",
  "priority",
  "deadline",
  "id",
  "status",
  "all",
  "date",
  "day",
  "month",
  "week",
  "year",
  "open",
  "format",
  "help",
  "version",
];

// --- Custom Help UI ---
const commandDetails = {
  add: {
    description: `Add a new instruction. ${chalk.yellow("New instructions are set to 'pending' status by default.")}`,
    usage: "inst add [options]",
    options: {
      "--source, -s": "The source or category (required).",
      "--instruction, -i": "The instruction text (required).",
      "--priority, -p": `Set a priority. Choices: ${chalk.yellow(optionChoices.priority.join(", "))}. ${chalk.gray('(default: "normal")')}`,
      "--deadline, -dl": "Set a deadline (e.g., 'tomorrow at 5pm').",
    },
  },
  show: {
    description: "Show instructions with powerful filters.",
    usage: "inst show [options]",
    options: {
      "--status, -s": `Filter by status. Choices: ${chalk.yellow(optionChoices.status.join(", "))}.`,
      "--priority, -p": `Filter by priority. Choices: ${chalk.yellow(optionChoices.priority.join(", "))}.`,
      "--source": "Filter by source.",
      "--deadline": "Show only instructions with a deadline.",
      "--date": `Filter by date (e.g., ${new Date().getFullYear()}-08-09).`,
      "--day": "Filter by day name.",
      "--month": "Filter by month (name or number 1-12).",
      "--week": "Filter by week of the month (1-5).",
      "--year": "Filter by year (e.g., 2025).",
      "--all": "Include deleted instructions.",
    },
  },
  edit: {
    description: "Edit an existing instruction.",
    usage: "inst edit --id <ID> [options]",
    options: {
      "--id, -i": "ID of the instruction to edit (required).",
      "--source, -s": "New source text.",
      "--instruction": "New instruction text.",
      "--priority, -p": `New priority. Choices: ${chalk.yellow(optionChoices.priority.join(", "))}.`,
      "--status, -st": `New status. Choices: ${chalk.yellow(optionChoices.status.join(", "))}.`,
      "--deadline, -dl": "New deadline.",
    },
  },
  mark: {
    description: "Mark an instruction with a new status.",
    usage: "inst mark --id <ID> --status <status>",
    options: {
      "--id, -i": "ID of the instruction to mark (required).",
      "--status, -s": `The new status (required). Choices: ${chalk.yellow(optionChoices.status.join(", "))}.`,
    },
  },
  delete: {
    description: "Mark an instruction as deleted.",
    usage: "inst delete --id <ID>",
    options: {
      "--id, -i": "ID of the instruction to delete (required).",
    },
  },
  recover: {
    description: "Recover a deleted instruction.",
    usage: "inst recover --id <ID>",
    options: {
      "--id, -i": "ID of the instruction to recover (required).",
    },
  },
  reset: {
    description: "Erase ALL instructions permanently.",
    usage: "inst reset",
  },
  undo: {
    description: "Revert the last change.",
    usage: "inst undo",
  },
  redo: {
    description: "Re-apply the last undone change.",
    usage: "inst redo",
  },
  total: {
    description: "Count instructions based on filters.",
    usage: "inst total [options]",
    options: {
      "...filters": "Accepts the same filters as the 'show' command.",
    },
  },
  export: {
    description: "Export instructions to a file.",
    usage: "inst export --format <format> [options]",
    options: {
      "--format": `The export format (required). Choices: ${chalk.yellow(optionChoices.format.join(", "))}.`,
      "--open": "Open the exported file automatically.",
      "...filters": "Accepts the same filters as the 'show' command.",
    },
  },
  manual: {
    description: "Saves the user manual as a PDF.",
    usage: "inst manual [--open]",
    options: {
      "--open": "Open the manual automatically after creation.",
    },
  },
};

function displayCustomHelp(command) {
  console.log(chalk.bold.cyan("\n📖 Inst CLI"));
  console.log(
    chalk.white("A powerful tool to manage all of life's instructions.")
  );

  if (command && commandDetails[command]) {
    const details = commandDetails[command];
    console.log(chalk.yellow(`\nHelp for command: ${chalk.bold(command)}`));
    console.log(chalk.white(`\n  ${details.description}`));
    console.log(
      chalk.white(`\n${chalk.bold("Usage:")} ${chalk.green(details.usage)}`)
    );

    if (details.options) {
      console.log(chalk.bold("\nOptions:"));
      Object.entries(details.options).forEach(([option, desc]) => {
        console.log(`  ${chalk.cyan(option.padEnd(20))} ${chalk.white(desc)}`);
      });
    }
  } else {
    console.log(
      chalk.white(
        `\n${chalk.bold("Usage:")} ${chalk.green("inst <command> [options]")}`
      )
    );
    console.log(chalk.bold("\nAvailable Commands:"));
    Object.entries(commandDetails).forEach(([cmd, details]) => {
      const alias = Object.entries(yargs().getOptions().alias).find(
        ([_key, val]) => val.includes(cmd)
      )?.[0];
      const commandString = alias ? `${cmd}, ${alias}` : cmd;
      console.log(
        `  ${chalk.green(commandString.padEnd(15))} ${chalk.white(details.description)}`
      );
    });
    console.log(
      chalk.yellow(
        "\nRun 'inst help <command>' for more details on a specific command."
      )
    );
  }
  console.log("");
}

// --- Global Loading Indicator ---
let loadingInterval;
let startTime;

function startLoadingMessage(prefix = "Processing") {
  startTime = process.hrtime.bigint();
  let dots = 0;
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 1);
  process.stdout.write(chalk.gray(`${prefix}...`));

  loadingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(chalk.gray(`${prefix}${".".repeat(dots)}`));
  }, 300);
}

function stopLoadingMessage() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 1);
    if (durationMs > 100) {
      console.log(
        chalk.gray(`Operation completed in ${durationMs.toFixed(2)} ms.`)
      );
    }
    loadingInterval = null;
  }
}

// --- Initial Setup & File System ---
function ensureDataFilesExist() {
  try {
    if (!fs.existsSync(CONFIG.DATA_DIR))
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    for (const file of [
      CONFIG.DATA_PATH,
      CONFIG.UNDO_STACK_FILE,
      CONFIG.REDO_STACK_FILE,
    ]) {
      if (!fs.existsSync(file)) fs.writeFileSync(file, "[]", "utf-8");
    }
  } catch (error) {
    console.error(
      chalk.red.bold(
        "❌ Critical Error: Could not create necessary data files."
      ),
      error
    );
    process.exit(1);
  }
}

const loadInstructions = async () => {
  try {
    return JSON.parse(await readFile(CONFIG.DATA_PATH, "utf-8"));
  } catch {
    stopLoadingMessage();
    console.error(
      chalk.red("⚠️  Warning: Could not parse data file. Returning empty list.")
    );
    return [];
  }
};
const saveInstructions = async (d) =>
  await writeFile(CONFIG.DATA_PATH, JSON.stringify(d, null, 2), "utf-8");

// --- Undo/Redo Stack Management ---
const readStack = async (stackFile) => {
  try {
    const data = await readFile(stackFile, "utf-8");
    return JSON.parse(data || "[]");
  } catch {
    return [];
  }
};

const writeStack = async (stackFile, stack) => {
  await writeFile(stackFile, JSON.stringify(stack, null, 2), "utf-8");
};

const pushToUndoStack = async (commandName) => {
  const [undoStack, currentData] = await Promise.all([
    readStack(CONFIG.UNDO_STACK_FILE),
    loadInstructions(),
  ]);
  undoStack.push({ command: commandName, data: currentData });
  if (undoStack.length > CONFIG.MAX_UNDO_REDO_STATES) undoStack.shift();
  await writeStack(CONFIG.UNDO_STACK_FILE, undoStack);
};

const popFromUndoStack = async () => {
  const undoStack = await readStack(CONFIG.UNDO_STACK_FILE);
  if (undoStack.length > 0) {
    const prevState = undoStack.pop();
    await pushToRedoStack(prevState.command);
    await saveInstructions(prevState.data);
    await writeStack(CONFIG.UNDO_STACK_FILE, undoStack);
    return prevState.command;
  }
  return null;
};

const pushToRedoStack = async (commandName) => {
  const [redoStack, currentData] = await Promise.all([
    readStack(CONFIG.REDO_STACK_FILE),
    loadInstructions(),
  ]);
  redoStack.push({ command: commandName, data: currentData });
  if (redoStack.length > CONFIG.MAX_UNDO_REDO_STATES) redoStack.shift();
  await writeStack(CONFIG.REDO_STACK_FILE, redoStack);
};

const popFromRedoStack = async () => {
  const redoStack = await readStack(CONFIG.REDO_STACK_FILE);
  if (redoStack.length > 0) {
    const nextState = redoStack.pop();
    await pushToUndoStack(nextState.command);
    await saveInstructions(nextState.data);
    await writeStack(CONFIG.REDO_STACK_FILE, redoStack);
    return nextState.command;
  }
  return null;
};

const clearRedoStack = () => writeStack(CONFIG.REDO_STACK_FILE, []);

// --- Helper & Utility Functions ---
function findSuggestion(unknown, list) {
  return list.reduce(
    (best, item) => {
      const distance = (s1, s2) => {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
          let lastValue = i;
          for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else if (j > 0) {
              let newValue = costs[j - 1];
              if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                newValue = Math.min(newValue, lastValue, costs[j]) + 1;
              costs[j - 1] = lastValue;
              lastValue = newValue;
            }
          }
          if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
      };
      const dist = distance(unknown, item);
      if (dist < best.minDistance && dist <= 2)
        return { minDistance: dist, match: item };
      return best;
    },
    { minDistance: Infinity, match: null }
  ).match;
}

function promptConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question + chalk.white(" (y/N): "), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function getDownloadsFolder() {
  const platform = process.platform;
  if (platform === "win32") {
    try {
      const command = `(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path`;
      let rawPath = execSync(`powershell -command "${command}"`, {
        encoding: "utf-8",
      }).trim();
      rawPath = rawPath.replace(/^%USERPROFILE%/i, os.homedir());
      return path.normalize(rawPath);
    } catch {
      return path.join(os.homedir(), "Downloads");
    }
  }
  return path.join(os.homedir(), "Downloads");
}

function openFile(filePath) {
  const command =
    process.platform === "win32"
      ? `start ""`
      : process.platform === "darwin"
        ? `open`
        : `xdg-open`;
  console.log(chalk.blue(`\n📂 Opening the file automatically...`));
  try {
    execSync(`${command} "${filePath}"`, { stdio: "ignore" });
  } catch (err) {
    console.error(
      chalk.red(`Failed to open file. Please open it manually:\n${filePath}`),
      err
    );
  }
}

function showNoResultsFeedback() {
  console.log(chalk.yellow("\n📭 No instructions match your filters."));
  console.log(
    chalk.blue(
      "💡 Tip: Try broadening your search or use 'inst show --all' to include deleted items."
    )
  );
}

// --- Date Helpers, Filter Logic, and Filename Generation ---
const getMonthName = (monthNumber) =>
  new Date(2000, monthNumber - 1, 1).toLocaleString("en-US", { month: "long" });
const getDayName = (date) =>
  date.toLocaleDateString("en-US", { weekday: "long" });
const getWeekOfMonth = (date) => Math.ceil(date.getDate() / 7);

function filterInstructions(instructions, filters) {
  let filteredData = [...instructions];

  if (filters.priority) {
    filteredData = filteredData.filter(
      (inst) => inst.priority === filters.priority
    );
  }
  if (filters.source) {
    filteredData = filteredData.filter(
      (inst) => inst.source.toLowerCase() === filters.source.toLowerCase()
    );
  }
  if (filters.status) {
    filteredData = filteredData.filter(
      (inst) => inst.status === filters.status
    );
  }
  if (filters.deadline) {
    filteredData = filteredData.filter((inst) => inst.deadline);
  }
  if (!filters.all) {
    filteredData = filteredData.filter((inst) => !inst.isDeleted);
  }

  const hasDateFilter =
    filters.date ||
    filters.day ||
    filters.month ||
    filters.year ||
    filters.week;
  if (hasDateFilter) {
    filteredData = filteredData.filter((inst) => {
      const checkDate = (dateString) => {
        if (!dateString) return false;
        const date = new Date(dateString);

        const dateMatch =
          !filters.date ||
          date.toISOString().slice(0, 10) ===
            new Date(filters.date).toISOString().slice(0, 10);
        const dayMatch =
          !filters.day ||
          getDayName(date).toLowerCase() === filters.day.toLowerCase();
        const monthMatch =
          !filters.month || date.getMonth() + 1 === filters.month;
        const yearMatch = !filters.year || date.getFullYear() === filters.year;
        const weekMatch =
          !filters.week || getWeekOfMonth(date) === filters.week;

        return dateMatch && dayMatch && monthMatch && yearMatch && weekMatch;
      };
      return checkDate(inst.added) || checkDate(inst.deadline);
    });
  }

  return filteredData;
}

function generateFileNameAndTitle(options) {
  const titleParts = [];
  const filenameParts = [];

  const getWeekSuffix = (week) => {
    if (week === 1) return "1st";
    if (week === 2) return "2nd";
    if (week === 3) return "3rd";
    return `${week}th`;
  };

  if (options.date) {
    titleParts.push(`for ${options.date}`);
    filenameParts.push(options.date);
  } else {
    const timeParts = [];
    if (options.day) timeParts.push(options.day);
    if (options.week) timeParts.push(`the ${getWeekSuffix(options.week)} week`);
    if (options.month) timeParts.push(`of ${getMonthName(options.month)}`);
    if (options.year) timeParts.push(String(options.year));
    if (timeParts.length > 0) {
      titleParts.push(`for ${timeParts.join(" ")}`);
      filenameParts.push(
        ...timeParts.map((p) => p.toLowerCase().replace(/ /g, "-"))
      );
    }
  }

  let title =
    titleParts.length > 0
      ? `Instructions ${titleParts.join(", ")}`
      : "All Instructions";
  let filename =
    filenameParts.length > 0 ? `inst_${filenameParts.join("_")}` : "inst_all";

  if (options.priority) {
    title += `, ${options.priority} priority`;
    filename += `_${options.priority}-priority`;
  }
  if (options.source) {
    title += `, from ${options.source}`;
    filename += `_from-${options.source.replace(/ /g, "-")}`;
  }
  if (options.status) {
    title += `, with status ${options.status}`;
    filename += `_${options.status}`;
  }
  if (options.deadline) {
    title += ", with deadlines";
    filename += "_with-deadline";
  }
  if (options.all) {
    title += " (including deleted)";
    filename += "_including-deleted";
  }

  filename = filename.replace("inst_all_", "inst_");
  title = title.replace("All Instructions, ", "Instructions ");

  return { titleLabel: title, filenameLabel: filename };
}

function validateFilterOptions(options) {
  if (options.date) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(options.date) ||
      isNaN(new Date(options.date).getTime())
    ) {
      return "Invalid date format for --date. Please use YYYY-MM-DD.";
    }
    if (options.day || options.month || options.week || options.year) {
      return "Cannot use --date with other time filters like --day, --month, etc.";
    }
  }
  if (options.week && !options.month) {
    return "The --week filter must be used with the --month filter.";
  }
  return true;
}

const weekCoercion = (week) => {
  if (week !== undefined) {
    if (typeof week !== "number" || week < 1 || week > 5) {
      throw new Error(
        `Invalid week value: The week must be a number between 1 and 5.`
      );
    }
  }
  return week;
};

function parseMonth(monthInput) {
  if (!monthInput) return null;

  const monthNumber = parseInt(monthInput, 10);
  if (!isNaN(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
    return monthNumber;
  }

  const monthStr = String(monthInput).toLowerCase().trim();
  const monthMap = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  return monthMap[monthStr] || null;
}

const monthCoercion = (monthInput) => {
  if (monthInput === undefined) return undefined;
  const monthNumber = parseMonth(monthInput);
  if (monthNumber === null) {
    throw new Error(`Invalid month: '${monthInput}'.`);
  }
  return monthNumber;
};

// --- PDF Generation Engine ---
function wrapTextForPdf(text, maxWidth, font, fontSize) {
  const words = String(text || "").split(/(\s+)/);
  let currentLine = "";
  const lines = [];
  for (const word of words) {
    const testLine = currentLine + word;
    if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word.trimStart();
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

async function createPdfReport(
  instructions,
  titleLabel,
  showDeletedAt = false
) {
  const pdfDoc = await PDFDocument.create();
  const [font, boldFont] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 50,
    footerMargin = 50;
  let y = height - margin;

  const headers = showDeletedAt
    ? [
        "ID",
        "Source",
        "Instruction",
        "Priority",
        "Status",
        "Deadline",
        "Added",
        "Deleted At",
      ]
    : [
        "ID",
        "Source",
        "Instruction",
        "Priority",
        "Status",
        "Deadline",
        "Added",
      ];

  const colWidths = showDeletedAt
    ? [30, 60, 135, 50, 60, 60, 60, 70]
    : [30, 70, 165, 50, 60, 70, 70];

  const fontSize = 9,
    headerFontSize = 10,
    lineGap = 5;

  const drawHeaders = (currentPage) => {
    let x = margin;
    headers.forEach((header, i) => {
      currentPage.drawText(header, {
        x,
        y,
        font: boldFont,
        size: headerFontSize,
      });
      x += colWidths[i];
    });
    y -= headerFontSize + lineGap;
    currentPage.drawLine({
      start: { x: margin, y: y + lineGap / 2 },
      end: { x: width - margin, y: y + lineGap / 2 },
      thickness: 1,
    });
    y -= lineGap;
  };

  const drawPageHeader = (currentPage) => {
    currentPage.drawText("Instruction Report", {
      x: margin,
      y,
      font: boldFont,
      size: 18,
    });
    const dateText = `Generated: ${new Date().toLocaleDateString()}`;
    const dateWidth = font.widthOfTextAtSize(dateText, 12);
    currentPage.drawText(dateText, {
      x: width - margin - dateWidth,
      y,
      font,
      size: 12,
    });
    y -= 18 + lineGap;
    currentPage.drawText(titleLabel, {
      x: margin,
      y,
      font,
      size: 12,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 12 + lineGap * 2;
  };

  drawPageHeader(page);
  drawHeaders(page);

  for (const inst of instructions) {
    // Sanitize user-provided text fields to remove newlines before PDF creation
    const sanitizedText = String(inst.text || "").replace(
      /(\r\n|\n|\r)/gm,
      " "
    );
    const sanitizedSource = String(inst.source || "").replace(
      /(\r\n|\n|\r)/gm,
      " "
    );

    const rowData = [
      String(inst.id),
      sanitizedSource,
      sanitizedText,
      inst.priority,
      inst.status,
      inst.deadline ? new Date(inst.deadline).toLocaleDateString() : "N/A",
      new Date(inst.added).toLocaleDateString(),
    ];
    if (showDeletedAt) {
      rowData.push(
        inst.deletedAt ? new Date(inst.deletedAt).toLocaleDateString() : "N/A"
      );
    }

    const wrappedRow = rowData.map((cellText, i) =>
      wrapTextForPdf(cellText, colWidths[i] - 4, font, fontSize)
    );
    const rowHeight =
      Math.max(...wrappedRow.map((lines) => lines.length)) *
        (fontSize + lineGap) +
      lineGap;

    if (y - rowHeight < footerMargin) {
      page = pdfDoc.addPage();
      y = height - margin;
      drawPageHeader(page);
      drawHeaders(page);
    }

    let x = margin;
    const startY = y;
    wrappedRow.forEach((lines, i) => {
      let cellY = startY;
      lines.forEach((line) => {
        page.drawText(line, { x: x + 2, y: cellY, font, size: fontSize });
        cellY -= fontSize + lineGap;
      });
      x += colWidths[i];
    });
    y -= rowHeight;
  }

  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    pages[i].drawText(`Page ${i + 1} of ${pages.length}`, {
      x: pages[i].getWidth() / 2 - 20,
      y: 30,
      font,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  return await pdfDoc.save();
}

const stripAnsi = (str) =>
  str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*.{0,2}(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );

async function generateManualPdf(argv) {
  startLoadingMessage("Generating manual");
  try {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const codeFont = await pdfDoc.embedFont(StandardFonts.Courier);

    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;
    let pageNumber = 1;

    const addPageIfNeeded = (requiredHeight) => {
      if (y - requiredHeight < margin) {
        page.drawText(`Page ${pageNumber}`, {
          x: width / 2 - 20,
          y: 30,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        page = pdfDoc.addPage();
        y = height - margin;
        pageNumber++;
        return true;
      }
      return false;
    };

    const addText = (text, options = {}) => {
      const {
        size = 10,
        font: textFont = font,
        color = rgb(0, 0, 0),
        indent = 0,
        spacing = 1.4,
      } = options;
      const lines = wrapTextForPdf(
        text,
        width - 2 * margin - indent,
        textFont,
        size
      );
      addPageIfNeeded(lines.length * size * spacing);
      lines.forEach((line) => {
        if (y < margin + size) addPageIfNeeded(size * spacing);
        page.drawText(line, {
          x: margin + indent,
          y,
          font: textFont,
          size,
          color,
        });
        y -= size * spacing;
      });
    };

    // --- Title Page ---
    addText("Inst CLI", {
      size: 36,
      font: boldFont,
      color: rgb(0.1, 0.4, 0.8),
    });
    addText("User Manual", {
      size: 24,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 40;
    addText("Your personal command-line task manager.", {
      size: 14,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    y = 100;
    addText(`Version 1.0.0 | Generated: ${new Date().toLocaleDateString()}`, {
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    addPageIfNeeded(height); // Force new page for content

    // --- Introduction ---
    y -= 20;
    addText("Introduction", {
      size: 18,
      font: boldFont,
      color: rgb(0.1, 0.4, 0.8),
    });
    y -= 5;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 15;
    addText(
      "Welcome to Inst CLI, a powerful and intuitive tool for managing all of life's instructions directly from your terminal. This guide will walk you through all the available commands and their options.",
      { size: 11 }
    );

    // --- Commands Section ---
    for (const [cmd, details] of Object.entries(commandDetails)) {
      y -= 30;
      addPageIfNeeded(80);
      addText(cmd, { size: 16, font: boldFont, color: rgb(0.1, 0.4, 0.8) });
      y -= 5;
      page.drawLine({
        start: { x: margin, y },
        end: { x: 200, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 15;

      addText(stripAnsi(details.description), { size: 10, indent: 10 });
      y -= 10;
      addText("Usage:", { size: 11, font: boldFont, indent: 10 });
      addText(details.usage, {
        size: 10,
        font: codeFont,
        color: rgb(0.1, 0.5, 0.1),
        indent: 20,
      });

      if (details.options) {
        y -= 10;
        addText("Options:", { size: 11, font: boldFont, indent: 10 });
        for (const [option, desc] of Object.entries(details.options)) {
          addText(stripAnsi(`${option.padEnd(20)} ${desc}`), {
            size: 9,
            font: codeFont,
            indent: 20,
          });
        }
      }
      y -= 10;
      addText("Example:", { size: 11, font: boldFont, indent: 10 });
      addText(commandExamples[cmd], {
        size: 10,
        font: codeFont,
        color: rgb(0.1, 0.5, 0.1),
        indent: 20,
      });
    }

    page.drawText(`Page ${pageNumber}`, {
      x: width / 2 - 20,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    const filePath = path.join(
      getDownloadsFolder(),
      `inst_manual_${Date.now()}.pdf`
    );
    await writeFile(filePath, pdfBytes);

    stopLoadingMessage();
    console.log(chalk.green.bold("\n✅ Manual Saved"));
    console.log(`   - Path: ${filePath}`);
    if (
      argv.open ||
      (await promptConfirmation(chalk.blue("💡 Open the manual now?")))
    ) {
      openFile(filePath);
    }
  } catch (err) {
    stopLoadingMessage();
    console.error(chalk.red("❌ Failed to generate PDF manual:"), err);
  }
}

// --- Custom Failure Handler ---
function customFailureHandler(msg, err, _yargs) {
  const command = process.argv[2];
  const errorMessage = msg || (err && err.message) || "";
  console.error();

  if (errorMessage.includes("Invalid week value")) {
    console.error(chalk.red(`❌ Error: Invalid value for --week.`));
    console.error(
      chalk.yellow(`\n💡 The week must be a number between 1 and 5.`)
    );
  } else if (errorMessage.includes("Invalid month:")) {
    console.error(
      chalk.red(`❌ Error: ${errorMessage.replace("Invalid month: ", "")}`)
    );
    console.error(
      chalk.yellow(
        `\n💡 Please use a month name (e.g., "August"), abbreviation (e.g., "Aug"), or number (1-12).`
      )
    );
  } else if (
    errorMessage.includes("week filter must be used with the --month")
  ) {
    console.error(chalk.red(`❌ Error: ${errorMessage}`));
    console.error(
      chalk.yellow(
        `\n💡 Please specify which month you want to filter by week (e.g., --week 1 --month 8).`
      )
    );
  } else if (
    errorMessage.includes("Cannot use --date with other time filters")
  ) {
    console.error(chalk.red(`❌ Error: ${errorMessage}`));
    console.error(
      chalk.yellow(
        `\n💡 Use either '--date' or broader filters like '--month', but not both.`
      )
    );
  } else if (msg && msg.startsWith("Unknown argument")) {
    const unknownOption = msg.split(":")[1].trim();
    console.error(chalk.red(`❌ Error: Unknown option: --${unknownOption}`));
    const suggestion = findSuggestion(unknownOption, allValidOptions);
    if (suggestion) {
      console.error(chalk.yellow(`\n💡 Did you mean '--${suggestion}'?`));
    }
  } else if (msg && msg.includes("Not enough arguments following")) {
    const option = msg.split(":")[1].trim();
    const prefix = option.length === 1 ? "-" : "--";
    console.error(
      chalk.red(`❌ Error: The '${prefix}${option}' option requires a value.`)
    );
    if (optionChoices[option]) {
      console.error(
        chalk.yellow(
          `\n💡 Please provide one of the available choices: ${optionChoices[option].join(", ")}.`
        )
      );
    } else {
      console.error(
        chalk.yellow(
          `\n💡 Please provide a value after the ${prefix}${option} flag.`
        )
      );
    }
  } else if (msg && msg.includes("Missing required argument")) {
    const missingArg = msg.split(":")[1].trim();
    const rawArgs = process.argv;
    const alias = optionAliases[missingArg]
      ? `-${optionAliases[missingArg]}`
      : null;

    if (
      rawArgs.includes(`--${missingArg}`) ||
      (alias && rawArgs.includes(alias))
    ) {
      console.error(
        chalk.red(`❌ Error: The '--${missingArg}' option requires a value.`)
      );
      if (optionChoices[missingArg]) {
        console.error(
          chalk.yellow(
            `\n💡 Please provide one of the available choices: ${optionChoices[missingArg].join(", ")}.`
          )
        );
      } else {
        console.error(
          chalk.yellow(
            `\n💡 Please provide a value after the --${missingArg} flag (e.g., --${missingArg} 123).`
          )
        );
      }
    } else {
      console.error(
        chalk.red(
          `❌ Error: The '--${missingArg}' option is required for the '${command}' command.`
        )
      );
      console.error(chalk.yellow(`\n💡 Please provide the missing option.`));
    }
  } else if (msg && msg.includes("Invalid values")) {
    const argMatch = msg.match(/Argument: (\w+)/);
    const arg = argMatch ? argMatch[1] : "option";
    const givenMatch = msg.match(/Given: "(.*?)"/);
    const givenValue = givenMatch ? givenMatch[1] : null;

    if (givenValue === null || givenValue === "") {
      console.error(
        chalk.red(`❌ Error: The '--${arg}' option requires a value.`)
      );
      if (optionChoices[arg]) {
        console.error(
          chalk.yellow(
            `\n💡 Please provide one of the available choices: ${optionChoices[arg].join(", ")}.`
          )
        );
      }
    } else {
      console.error(
        chalk.red(`❌ Error: Invalid value provided for the '--${arg}' option.`)
      );
      const choicesMatch = msg.match(/Allowed: (.*)/);
      if (choicesMatch && choicesMatch[1]) {
        console.error(
          chalk.yellow(
            `\n💡 Please choose one of the following: ${choicesMatch[1]}`
          )
        );
      }
    }
  } else if (msg) {
    console.error(chalk.red(`❌ Error: ${msg}`));
  } else {
    console.error(chalk.red("\n❌ An unexpected error occurred."));
    if (err) console.error(chalk.red(`   Error: ${err.message || err}`));
  }

  let example =
    command && commandExamples[command] ? commandExamples[command] : null;
  if (
    command === "list" ||
    command === "show" ||
    command === "total" ||
    command === "export"
  ) {
    const rawArgs = process.argv;
    const weekArg = rawArgs.find((arg) => arg.includes("--week"));
    if (errorMessage.includes("week filter must be used with the --month")) {
      const weekVal = weekArg
        ? weekArg.split("=")[1] || rawArgs[rawArgs.indexOf(weekArg) + 1] || "1"
        : "1";
      example = `inst ${command} --week ${weekVal} --month 8`;
    } else if (errorMessage.includes("Invalid week value")) {
      example = `inst ${command} --week 1 --month 8`;
    } else if (errorMessage.includes("day")) {
      example = `inst ${command} --day Monday`;
    }
  }
  if (example && command === "export") {
    if (!example.includes("--format")) {
      example += " --format pdf";
    }
  }

  if (example) {
    console.error(chalk.green(`\n✅ Example: ${example}`));
  }
  console.error(
    chalk.blue(`\nFor more help, run: inst ${command || ""} --help`)
  );
  process.exit(1);
}

// --- Main Execution Logic ---
async function main() {
  ensureDataFilesExist();
  const rawArgs = hideBin(process.argv);

  const allValidCommands = new Set([
    "add",
    "a",
    "show",
    "list",
    "ls",
    "edit",
    "e",
    "mark",
    "m",
    "delete",
    "del",
    "d",
    "recover",
    "rec",
    "reset",
    "undo",
    "redo",
    "manual",
    "export",
    "ex",
    "total",
    "t",
    "help",
  ]);

  const potentialCommand = rawArgs[0];
  const helpRequested = rawArgs.includes("--help") || rawArgs.includes("-h");

  // Handle no command or general help
  if (
    rawArgs.length === 0 ||
    (rawArgs.length === 1 && helpRequested && !potentialCommand)
  ) {
    displayCustomHelp();
    return;
  }

  // Handle `inst help <command>`
  if (potentialCommand === "help") {
    displayCustomHelp(rawArgs[1]);
    return;
  }

  // Check for command typos first
  if (potentialCommand && !potentialCommand.startsWith("-")) {
    if (!allValidCommands.has(potentialCommand)) {
      const suggestion = findSuggestion(
        potentialCommand,
        Array.from(allValidCommands)
      );
      if (suggestion) {
        console.error(
          chalk.red(
            `\n❌ Unknown command '${potentialCommand}'. Did you mean ${chalk.bold(suggestion)}?`
          )
        );
        if (helpRequested) {
          console.log(
            chalk.yellow(`\nShowing help for '${suggestion}' instead.`)
          );
          displayCustomHelp(suggestion);
        }
      } else {
        console.error(chalk.red(`\n❌ Unknown command '${potentialCommand}'.`));
        console.log(
          chalk.blue(
            `\nFor a list of available commands, type: ${chalk.bold("inst --help")}`
          )
        );
      }
      process.exit(1);
    }
  }

  // Handle specific command help (e.g., `inst add --help`)
  if (helpRequested) {
    displayCustomHelp(potentialCommand);
    return;
  }

  yargs(rawArgs)
    .scriptName("inst")
    .command({
      command: "add",
      aliases: ["a"],
      describe: "Add a new instruction.",
      builder: (yargs) =>
        yargs
          .option("source", {
            alias: "s",
            describe: "The source or category",
            type: "string",
            requiresArg: true,
          })
          .option("instruction", {
            alias: "i",
            describe: "The instruction text",
            type: "string",
            requiresArg: true,
          })
          .option("priority", {
            alias: "p",
            describe: "Set a priority",
            type: "string",
            choices: ["high", "medium", "low", "normal"],
            default: "normal",
          })
          .option("deadline", {
            alias: "dl",
            describe: "Set a deadline (e.g., 'tomorrow at 5pm')",
            type: "string",
            requiresArg: true,
          })
          .demandOption(["source", "instruction"]),
      handler: async (argv) => {
        startLoadingMessage("Adding instruction");
        try {
          await pushToUndoStack("add");
          await clearRedoStack();
          const instructions = await loadInstructions();
          const newId =
            instructions.length > 0
              ? Math.max(...instructions.map((i) => i.id)) + 1
              : 1;
          const deadlineDate = argv.deadline
            ? chrono.parseDate(argv.deadline)
            : null;
          if (argv.deadline && !deadlineDate) {
            console.log(
              chalk.red.bold(
                "❌ Invalid deadline format. Could not parse the date."
              )
            );
            return;
          }
          instructions.push({
            id: newId,
            source: argv.source,
            text: argv.instruction,
            added: new Date().toISOString(),
            priority: argv.priority,
            deadline: deadlineDate ? deadlineDate.toISOString() : null,
            status: "pending",
            isDeleted: false,
            deletedAt: null,
          });
          await saveInstructions(instructions);
          console.log(chalk.green.bold("\n✅ Instruction Added"));
          console.log(`   - ID: ${newId}`);
          console.log(`   - Source: ${argv.source}`);
          console.log(
            chalk.yellow("💡 Tip: Use 'inst undo' to revert this change.")
          );
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "show",
      aliases: ["list", "ls"],
      describe: "Show instructions with powerful filters.",
      builder: (yargs) =>
        yargs
          .option("status", {
            alias: "s",
            describe: "Filter by status",
            type: "string",
            choices: Object.keys(CONFIG.STATUS_SYMBOLS),
          })
          .option("all", {
            describe: "Include deleted instructions",
            type: "boolean",
          })
          .option("date", {
            describe: `Filter by date (e.g., ${new Date().getFullYear()}-08-07)`,
            type: "string",
            requiresArg: true,
          })
          .option("day", {
            describe: "Filter by day name",
            type: "string",
            requiresArg: true,
          })
          .option("month", {
            describe: "Filter by month (name or 1-12)",
            type: "string",
            requiresArg: true,
          })
          .option("week", {
            describe: "Filter by week of month (1-5)",
            type: "number",
            requiresArg: true,
          })
          .option("year", {
            describe: "Filter by year (YYYY)",
            type: "number",
            requiresArg: true,
          })
          .option("priority", {
            alias: "p",
            describe: "Filter by priority",
            type: "string",
            choices: Object.keys(CONFIG.PRIORITY_ORDER),
          })
          .option("source", {
            describe: "Filter by source",
            type: "string",
            requiresArg: true,
          })
          .option("deadline", {
            describe: "Show only instructions with a deadline",
            type: "boolean",
          })
          .check(validateFilterOptions)
          .coerce("week", weekCoercion)
          .coerce("month", monthCoercion),
      handler: async (argv) => {
        startLoadingMessage("Fetching instructions");
        try {
          let instructions = await loadInstructions();
          let filtered = filterInstructions(instructions, argv);
          if (filtered.length === 0) {
            showNoResultsFeedback();
            return;
          }
          const { titleLabel } = generateFileNameAndTitle(argv);
          console.log(chalk.inverse.bold(`\n--- Showing ${titleLabel} ---\n`));
          filtered.sort(
            (a, b) =>
              (CONFIG.PRIORITY_ORDER[a.priority] || 4) -
              (CONFIG.PRIORITY_ORDER[b.priority] || 4)
          );

          filtered.forEach((inst) => {
            const P_COLOR =
              {
                high: chalk.red.bold,
                medium: chalk.yellow.bold,
                low: chalk.green.bold,
                normal: chalk.white,
              }[inst.priority] || chalk.white;
            const S_COLOR =
              {
                completed: chalk.green,
                processing: chalk.blue,
                paused: chalk.yellow,
                pending: chalk.white,
              }[inst.status] || chalk.gray;

            const header = `${CONFIG.STATUS_SYMBOLS[inst.status] || " "}  ${chalk.cyan(`ID: ${inst.id}`)} | ${P_COLOR(`PRIORITY: ${inst.priority.toUpperCase()}`)} | ${S_COLOR(`STATUS: ${inst.status}`)} | ${chalk.yellow(inst.source)}`;
            const text = `   ${chalk.cyan.bold("Instruction:")} ${inst.text}`;
            const deadline = inst.deadline
              ? `   ${chalk.magentaBright(`Due: ${new Date(inst.deadline).toLocaleString()}`)}`
              : "";
            const deleted = inst.isDeleted
              ? chalk.red.bold("   [DELETED]")
              : "";

            const card =
              inst.status === "completed" && !inst.isDeleted
                ? chalk.gray.strikethrough
                : (str) => str;

            console.log(card(header));
            console.log(card(text));
            if (deadline) console.log(card(deadline));
            if (deleted) console.log(deleted);
            console.log(card(chalk.gray("─".repeat(80))));
          });
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "edit",
      aliases: ["e"],
      describe: "Edit an existing instruction.",
      builder: (yargs) =>
        yargs
          .option("id", {
            alias: "i",
            describe: "ID to edit",
            type: "number",
            requiresArg: true,
          })
          .option("source", {
            alias: "s",
            describe: "New source",
            type: "string",
            requiresArg: true,
          })
          .option("instruction", {
            describe: "New instruction text",
            type: "string",
            requiresArg: true,
          })
          .option("priority", {
            alias: "p",
            describe: "New priority",
            type: "string",
            choices: ["high", "medium", "low", "normal"],
          })
          .option("status", {
            alias: "st",
            describe: "New status",
            type: "string",
            choices: Object.keys(CONFIG.STATUS_SYMBOLS),
            requiresArg: true,
          })
          .option("deadline", {
            alias: "dl",
            describe: "New deadline",
            type: "string",
            requiresArg: true,
          })
          .demandOption("id"),
      handler: async (argv) => {
        startLoadingMessage("Editing instruction");
        try {
          const instructions = await loadInstructions();
          const instIndex = instructions.findIndex(
            (inst) => inst.id === argv.id
          );
          if (instIndex === -1) {
            console.log(
              chalk.yellow(
                `ℹ️ This ID does not exist. No instruction found with ID: ${argv.id}`
              )
            );
            return;
          }
          if (instructions[instIndex].isDeleted) {
            console.log(
              chalk.yellow(
                `ℹ️  Cannot edit a deleted instruction. Recover first.`
              )
            );
            return;
          }
          const instToEdit = instructions[instIndex];
          let changed = false;
          if (argv.source) {
            instToEdit.source = argv.source;
            changed = true;
          }
          if (argv.instruction) {
            instToEdit.text = argv.instruction;
            changed = true;
          }
          if (argv.priority) {
            instToEdit.priority = argv.priority;
            changed = true;
          }
          if (argv.status) {
            instToEdit.status = argv.status;
            changed = true;
          }
          if (argv.deadline) {
            const deadlineDate = chrono.parseDate(argv.deadline);
            if (!deadlineDate) {
              console.log(chalk.red.bold("❌ Invalid deadline format."));
              return;
            }
            instToEdit.deadline = deadlineDate.toISOString();
            changed = true;
          }

          if (changed) {
            await pushToUndoStack("edit");
            await clearRedoStack();
            await saveInstructions(instructions);
            console.log(chalk.green.bold("\n✅ Instruction Updated"));
            console.log(`   - ID: ${argv.id}`);
            console.log(
              chalk.blue("💡 Tip: Use 'inst show' to see your changes.")
            );
          } else {
            console.log(
              chalk.yellow(
                `\nℹ️  No changes provided. To edit, supply an option like --priority or --instruction.`
              )
            );
            console.log(chalk.green(`   Example: ${commandExamples.edit}`));
          }
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "mark",
      aliases: ["m"],
      describe: "Mark an instruction with a new status.",
      builder: (yargs) =>
        yargs
          .option("id", {
            alias: "i",
            describe: "The ID to mark",
            type: "number",
            requiresArg: true,
          })
          .option("status", {
            alias: "s",
            describe: "The new status",
            type: "string",
            choices: Object.keys(CONFIG.STATUS_SYMBOLS),
            requiresArg: true,
          })
          .demandOption(["id", "status"]),
      handler: async (argv) => {
        startLoadingMessage("Updating status");
        try {
          const instructions = await loadInstructions();
          const instIndex = instructions.findIndex(
            (inst) => inst.id === argv.id
          );
          if (instIndex === -1) {
            console.log(
              chalk.yellow(
                `ℹ️ This ID does not exist. No instruction found with ID: ${argv.id}`
              )
            );
            return;
          }
          if (instructions[instIndex].isDeleted) {
            console.log(
              chalk.yellow(
                `ℹ️  Cannot mark a deleted instruction. Please recover it first.`
              )
            );
            return;
          }
          if (instructions[instIndex].status === argv.status) {
            console.log(
              chalk.yellow(
                `\nℹ️  Instruction #${argv.id} is already marked as "${argv.status}". No change made.\n`
              )
            );
            return;
          }

          await pushToUndoStack("mark");
          await clearRedoStack();
          const oldStatus = instructions[instIndex].status;
          instructions[instIndex].status = argv.status;
          await saveInstructions(instructions);

          stopLoadingMessage();
          if (argv.status === "completed") {
            const animation = chalkAnimation.rainbow(
              `\n🎉 Instruction #${argv.id} Completed! Well done! 🎉`
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            animation.stop();
          } else {
            console.log(
              chalk.green.bold(`\n✅ Status Updated for ID: ${argv.id}`)
            );
            console.log(`   - From: ${oldStatus}`);
            console.log(`   - To: ${argv.status}`);
          }
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "delete",
      aliases: ["del", "d"],
      describe: "Mark an instruction as deleted.",
      builder: (yargs) =>
        yargs
          .option("id", {
            alias: "i",
            describe: "ID to delete",
            type: "number",
            requiresArg: true,
          })
          .demandOption("id"),
      handler: async (argv) => {
        startLoadingMessage("Deleting instruction");
        try {
          const instructions = await loadInstructions();
          const instIndex = instructions.findIndex(
            (inst) => inst.id === argv.id && !inst.isDeleted
          );
          if (instIndex === -1) {
            console.log(
              chalk.yellow(
                `ℹ️ This ID does not exist or is already deleted. No active instruction found with ID: ${argv.id}`
              )
            );
            return;
          }
          stopLoadingMessage();
          if (
            await promptConfirmation(
              chalk.red.bold(
                `⚠️  Are you sure you want to delete instruction #${argv.id}?`
              )
            )
          ) {
            await pushToUndoStack("delete");
            await clearRedoStack();
            instructions[instIndex].isDeleted = true;
            instructions[instIndex].deletedAt = new Date().toISOString();
            await saveInstructions(instructions);
            console.log(chalk.green.bold(`\n✅ Instruction Deleted`));
            console.log(`   - ID: ${argv.id}`);
            console.log(
              chalk.yellow(
                `💡 Tip: Use 'inst recover --id ${argv.id}' to restore it.`
              )
            );
          } else {
            console.log(chalk.yellow("\nOperation cancelled."));
          }
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "recover",
      aliases: ["rec"],
      describe: "Recover a deleted instruction.",
      builder: (yargs) =>
        yargs
          .option("id", {
            alias: "i",
            describe: "ID to recover",
            type: "number",
            requiresArg: true,
          })
          .demandOption("id"),
      handler: async (argv) => {
        startLoadingMessage("Recovering instruction");
        try {
          const instructions = await loadInstructions();
          const instIndex = instructions.findIndex(
            (inst) => inst.id === argv.id
          );
          if (instIndex === -1 || !instructions[instIndex].isDeleted) {
            console.log(
              chalk.yellow(
                `ℹ️ This ID does not exist or is not deleted. No deleted instruction found with ID: ${argv.id}`
              )
            );
            return;
          }
          await pushToUndoStack("recover");
          await clearRedoStack();
          instructions[instIndex].isDeleted = false;
          instructions[instIndex].deletedAt = null;
          await saveInstructions(instructions);
          console.log(chalk.green.bold(`\n✅ Instruction Recovered`));
          console.log(`   - ID: ${argv.id}`);
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "reset",
      describe: "Erase ALL instructions permanently.",
      handler: async () => {
        startLoadingMessage("Resetting database");
        try {
          stopLoadingMessage();
          if (
            await promptConfirmation(
              chalk.red.bold(
                "⚠️ DANGER: This will erase ALL instructions. Are you sure?"
              )
            )
          ) {
            await pushToUndoStack("reset");
            await clearRedoStack();
            await saveInstructions([]);
            console.log(chalk.green.bold("\n✅ All Instructions Erased"));
            console.log(
              chalk.yellow(
                "💡 Tip: Use 'inst undo' immediately to revert this action."
              )
            );
          } else {
            console.log(chalk.yellow("\nOperation cancelled."));
          }
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "undo",
      describe: "Revert the last change.",
      handler: async () => {
        const undoStack = await readStack(CONFIG.UNDO_STACK_FILE);
        if (undoStack.length === 0) {
          console.log(chalk.yellow("ℹ️  Nothing to undo."));
          return;
        }
        const lastCommand = undoStack[undoStack.length - 1].command;
        if (
          await promptConfirmation(
            chalk.yellow(`Undo the last '${lastCommand}' operation?`)
          )
        ) {
          startLoadingMessage("Undoing operation");
          const undoneCommand = await popFromUndoStack();
          stopLoadingMessage();
          if (undoneCommand) {
            console.log(chalk.green.bold(`\n✅ Operation Undone`));
            console.log(`   - Reverted: '${undoneCommand}'`);
            console.log(
              chalk.blue(`💡 Tip: Use 'inst redo' to re-apply the change.`)
            );
          }
        } else {
          console.log(chalk.yellow("\nOperation cancelled."));
        }
      },
    })
    .command({
      command: "redo",
      describe: "Re-apply the last undone change.",
      handler: async () => {
        const redoStack = await readStack(CONFIG.REDO_STACK_FILE);
        if (redoStack.length === 0) {
          console.log(chalk.yellow("ℹ️  Nothing to redo."));
          return;
        }
        const nextCommand = redoStack[redoStack.length - 1].command;
        if (
          await promptConfirmation(
            chalk.blue(`Redo the last '${nextCommand}' operation?`)
          )
        ) {
          startLoadingMessage("Redoing operation");
          const redoneCommand = await popFromRedoStack();
          stopLoadingMessage();
          if (redoneCommand) {
            console.log(chalk.green.bold(`\n✅ Operation Redone`));
            console.log(`   - Re-applied: '${redoneCommand}'`);
          }
        } else {
          console.log(chalk.yellow("\nOperation cancelled."));
        }
      },
    })
    .command({
      command: "manual",
      describe: "Saves the user manual as a PDF.",
      builder: (yargs) =>
        yargs.option("open", {
          describe: "Open the manual automatically after creation.",
          type: "boolean",
        }),
      handler: async (argv) => await generateManualPdf(argv),
    })
    .command({
      command: "total",
      aliases: ["t"],
      describe: "Count instructions based on filters.",
      builder: (yargs) =>
        yargs
          .option("status", {
            describe: "Filter by status",
            type: "string",
            requiresArg: true,
          })
          .option("all", { describe: "Include deleted items", type: "boolean" })
          .option("date", {
            describe: "Filter by date",
            type: "string",
            requiresArg: true,
          })
          .option("day", {
            describe: "Filter by day name",
            type: "string",
            requiresArg: true,
          })
          .option("month", {
            describe: "Filter by month (name or 1-12)",
            type: "string",
            requiresArg: true,
          })
          .option("week", {
            describe: "Filter by week of month (1-5)",
            type: "number",
            requiresArg: true,
          })
          .option("year", {
            describe: "Filter by year",
            type: "number",
            requiresArg: true,
          })
          .option("priority", {
            describe: "Filter by priority",
            type: "string",
            requiresArg: true,
          })
          .option("source", {
            describe: "Filter by source",
            type: "string",
            requiresArg: true,
          })
          .option("deadline", {
            describe: "Filter by deadline existence",
            type: "boolean",
          })
          .check(validateFilterOptions)
          .coerce("week", weekCoercion)
          .coerce("month", monthCoercion),
      handler: async (argv) => {
        startLoadingMessage("Calculating total");
        try {
          const filtered = filterInstructions(await loadInstructions(), argv);
          if (filtered.length === 0) {
            showNoResultsFeedback();
            return;
          }
          const { titleLabel } = generateFileNameAndTitle(argv);
          console.log(chalk.blueBright(`\n📊 Total for: ${titleLabel}`));
          console.log(
            chalk.green.bold(
              `   Found ${filtered.length} instruction${filtered.length === 1 ? "" : "s"}.\n`
            )
          );
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "export",
      aliases: ["ex"],
      describe: "Export instructions to a file.",
      builder: (yargs) =>
        yargs
          .option("format", {
            describe: "Specify format for the export",
            type: "string",
            choices: ["pdf", "csv"],
            demandOption: true,
            requiresArg: true,
          })
          .option("open", {
            describe: "Open the exported file automatically",
            type: "boolean",
          })
          .option("status", {
            describe: "Filter by status",
            type: "string",
            requiresArg: true,
          })
          .option("all", { describe: "Include deleted items", type: "boolean" })
          .option("date", {
            describe: "Filter by date",
            type: "string",
            requiresArg: true,
          })
          .option("day", {
            describe: "Filter by day name",
            type: "string",
            requiresArg: true,
          })
          .option("month", {
            describe: "Filter by month (name or 1-12)",
            type: "string",
            requiresArg: true,
          })
          .option("week", {
            describe: "Filter by week of month (1-5)",
            type: "number",
            requiresArg: true,
          })
          .option("year", {
            describe: "Filter by year",
            type: "number",
            requiresArg: true,
          })
          .option("priority", {
            describe: "Filter by priority",
            type: "string",
            requiresArg: true,
          })
          .option("source", {
            describe: "Filter by source",
            type: "string",
            requiresArg: true,
          })
          .option("deadline", {
            describe: "Filter by deadline existence",
            type: "boolean",
          })
          .check(validateFilterOptions)
          .coerce("week", weekCoercion)
          .coerce("month", monthCoercion),
      handler: async (argv) => {
        startLoadingMessage(`Exporting to ${argv.format.toUpperCase()}`);
        try {
          let instructions = filterInstructions(await loadInstructions(), argv);
          if (instructions.length === 0) {
            showNoResultsFeedback();
            return;
          }
          const { filenameLabel, titleLabel } = generateFileNameAndTitle(argv);
          const filePath = path.join(
            getDownloadsFolder(),
            `${filenameLabel}_${Date.now()}.${argv.format}`
          );

          if (argv.format === "csv") {
            const escapeCsv = (text) =>
              `"${String(text ?? "").replace(/"/g, '""')}"`;
            const headers =
              "ID,Source,Instruction,Priority,Status,Deadline,Added,IsDeleted,DeletedAt\n";
            const rows = instructions
              .map((i) =>
                [
                  i.id,
                  i.source,
                  i.text,
                  i.priority,
                  i.status,
                  i.deadline ? new Date(i.deadline).toLocaleString() : "",
                  i.added ? new Date(i.added).toLocaleString() : "",
                  i.isDeleted,
                  i.deletedAt ? new Date(i.deletedAt).toLocaleString() : "",
                ]
                  .map(escapeCsv)
                  .join(",")
              )
              .join("\n");
            await writeFile(filePath, "\uFEFF" + headers + rows, "utf-8");
          } else {
            const pdfBytes = await createPdfReport(
              instructions,
              titleLabel,
              argv.all
            );
            await writeFile(filePath, pdfBytes);
          }
          console.log(chalk.green.bold(`\n✅ Export Successful`));
          console.log(chalk.blueBright(`   - Content: ${titleLabel}`));
          console.log(`   - Format: ${argv.format.toUpperCase()}`);
          console.log(`   - Path: ${filePath}`);
          if (argv.open) openFile(filePath);
        } finally {
          stopLoadingMessage();
        }
      },
    })
    .command({
      command: "help [command]",
      describe: "Display help information.",
      handler: (argv) => {
        displayCustomHelp(argv.command);
      },
    })
    .strict()
    .help(false) // Disable default help
    .version("1.0.0")
    .alias("v", "version")
    .epilogue("For more help, run 'inst manual' or find the project on GitHub.")
    .fail(customFailureHandler)
    .parse();
}

// --- Run the main application ---
main().catch((err) => {
  stopLoadingMessage();
  console.error(chalk.red("\nAn unexpected error occurred:"), err.message);
  process.exit(1);
});
