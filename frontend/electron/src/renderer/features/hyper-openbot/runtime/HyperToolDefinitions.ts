// Adapted from OpenBot at f8af37ab73e96784f174a11104505a965e722cab.
// MIT License. Copyright (c) 2026 CopilotKit. See ../LICENSE.
import { z } from "zod";

export const HYPER_COMPUTER_TOOLS = [
  { name: "computer_navigate",
    description:
      "Open a web page on your own computer so the person can watch. Use this when asked to open, " +
      "visit or read a particular website. It is not a web search: never open a search engine with " +
      "it to look something up. Returns the page title and its readable text, so answer from what " +
      "comes back rather than telling the person to go and look.",
    parameters: z.object({
      url: z.string().describe("Full web address to open, including https://"),
    }),
  },
  { name: "computer_read",
    description:
      "Read the page currently open on your computer, without opening anything. Use this after you " +
      "click something that changes the page, such as submitting a form, to find out what it now says.",
    parameters: z.object({}),
  },
  { name: "computer_snapshot",
    description:
      "List the things on the current page you can act on: fields, buttons, links and checkboxes, " +
      "each with a ref, its label and its current value. Call this BEFORE clicking or typing, and " +
      "use the refs it returns. Always send back the snapshotId it gives you. If an action reports " +
      "that your refs are stale, the page changed: call this again and use the new refs.",
    parameters: z.object({}),
  },
  { name: "computer_type",
    description:
      "Enter text into a field on the page. Give the ref of the field from your most recent " +
      "snapshot and the snapshotId it came from. This replaces whatever the field already contains. " +
      "Set submit to true to press Enter afterwards.",
    parameters: z.object({
      ref: z
        .string()
        .describe("Ref of the field, from your most recent snapshot"),
      snapshotId: z.number().describe("The snapshotId that ref came from"),
      text: z.string().describe("The text to enter"),
      submit: z
        .boolean()
        .optional()
        .describe("Press Enter after typing, to submit a single-field form"),
    }),
  },
  { name: "computer_click",
    description:
      "Click something on the page: a button, a link, a checkbox or a radio option. Give the ref " +
      "from your most recent snapshot and the snapshotId it came from.",
    parameters: z.object({
      ref: z
        .string()
        .describe(
          "Ref of the element to click, from your most recent snapshot",
        ),
      snapshotId: z.number().describe("The snapshotId that ref came from"),
    }),
  },
  { name: "computer_key",
    description:
      "Press a key, such as Enter, Tab or Escape. Give a ref to press it while a particular field " +
      "is focused, or omit the ref to press it on the page.",
    parameters: z.object({
      key: z.string().describe("Key name, such as Enter, Tab or Escape"),
      ref: z.string().optional().describe("Optional ref to press the key on"),
      snapshotId: z
        .number()
        .optional()
        .describe("The snapshotId the ref came from, required if ref is given"),
    }).refine(value => value.ref === undefined || value.snapshotId !== undefined, { path: ['snapshotId'], message: 'snapshotId is required when ref is supplied' }),
  },
  { name: "computer_list_files",
    description:
      "List what is in your workspace: every file and folder you have saved, with sizes. Call this " +
      "FIRST when you are asked what files you have, or before reading a file whose exact name you " +
      "are not sure of. Never guess a filename.",
    parameters: z.object({
      path: z
        .string()
        .optional()
        .describe("Optional folder to list. Omit for the whole workspace."),
    }),
    // Activity is read from the conversation this answer lands in: see `useConversationActivity`.
  },
  { name: "computer_read_file",
    description:
      "Read a file you saved earlier in your own workspace. Paths are relative to your workspace, " +
      "such as notes.md or reports/august.csv. Your workspace survives between conversations, so use " +
      "this to pick up notes you made before.",
    parameters: z.object({
      path: z
        .string()
        .describe("Path relative to your workspace, such as notes.md"),
    }),
  },
  { name: "computer_run_command",
    description:
      "Run a shell command on your own computer. Use this for anything the browser cannot do: " +
      "installing a tool you need, processing a file you saved, running a script. The working " +
      "directory is your workspace, so paths are relative to it and files you write here are the " +
      "same ones the file tools see. Commands run in bash, so pipes and && work. Long output is " +
      "truncated from the start, and a command that runs too long is stopped. " +
      "Installed: Python 3 (`python3`) with pip, openpyxl, pandas, python-docx, python-pptx, " +
      "matplotlib, pypdf, pdfplumber and reportlab; Node.js and Bun; curl, unzip and the usual " +
      "Linux tools. There is no LibreOffice, so nothing here calculates spreadsheet formulas: " +
      "write them with openpyxl and Excel or Google Sheets calculates them when the file is " +
      "opened. `pip install <package>` adds a Python package. " +
      "For package installation, check `id -u` first. As root (0), use " +
      "`apt-get update && apt-get install -y <package>` directly; otherwise use " +
      "`sudo openbot-apt update && sudo openbot-apt install <package>`, which takes package " +
      "names and nothing else, not `sudo apt-get`. If installation is refused, say so rather " +
      "than retrying.",
    parameters: z.object({
      command: z
        .string()
        .describe(
          "The command to run, such as: apt-get install -y jq (as root)",
        ),
    }),
    /*
     * NOT WHERE ACTIVITY IS RECORDED, though it once was. A command is a change, and the approval
     * wrapper sends a change to the server's gate without calling this at all: the gate runs it and
     * answers, or runs it after a person allows it and continues the conversation itself. Recorded
     * here, the pane beside the screen stayed empty while a Bot ran command after command. Every one
     * of those paths ends with the answer in the conversation, which is what the pane reads; see
     * `useConversationActivity`.
     */
  },
  { name: "computer_write_file",
    description:
      "Save a file in your own workspace so you still have it later. Paths are relative to your " +
      "workspace and folders are created as needed. Set append to true to add to the end of an " +
      "existing file rather than replacing it. Text only.",
    parameters: z.object({
      path: z
        .string()
        .describe(
          "Path relative to your workspace, such as reports/august.csv",
        ),
      contents: z.string().describe("The text to save"),
      append: z
        .boolean()
        .optional()
        .describe("Add to the end of the file instead of replacing it"),
    }),
  },
  { name: "computer_scroll",
    description:
      "Scroll the page down, or up with a negative amount, to bring more of a long page into view.",
    parameters: z.object({
      deltaY: z
        .number()
        .optional()
        .describe("Pixels to scroll; positive is down. Defaults to 600."),
    }),
  },
] as const;
