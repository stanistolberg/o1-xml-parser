"use server";

import { promises as fs } from "fs";
import { applyFileChanges } from "@/lib/apply-changes";
import { parseXmlString } from "@/lib/xml-parser";
import path from "path";

interface FileResult {
  filePath: string;
  absolutePath: string;
  error?: string;
}

interface ApplyChangesResult {
  succeededFiles: FileResult[];
  failedFiles: FileResult[];
}

export async function applyChangesAction(xml: string, projectDirectory: string): Promise<ApplyChangesResult> {
  console.log("Received XML input for processing...");

  const succeededFiles: FileResult[] = [];
  const failedFiles: FileResult[] = [];

  try {
    const changes = await parseXmlString(xml);
    console.log("Parsed file changes:", changes);

    if (!changes || changes.length === 0) {
      throw new Error("No valid file changes parsed from XML.");
    }

    let finalDirectory = projectDirectory && projectDirectory.trim() !== ""
      ? projectDirectory.trim()
      : process.env.PROJECT_DIRECTORY;

    if (!finalDirectory) {
      throw new Error("No project directory provided or set in environment. Please specify a valid directory.");
    }

    finalDirectory = path.resolve(finalDirectory);
    console.log("Target directory resolved to:", finalDirectory);

    try {
      await fs.access(finalDirectory);
    } catch {
      throw new Error(`Cannot access directory: ${finalDirectory}. Ensure it exists and permissions are correct.`);
    }

    for (const file of changes) {
      try {
        console.log(`Attempting to process file operation '${file.file_operation}' on '${file.file_path}'...`);
        const absPath = await applyFileChanges(file, finalDirectory);
        console.log(`Success: ${file.file_path} → ${absPath}`);
        succeededFiles.push({ filePath: file.file_path, absolutePath: absPath });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Failed to process ${file.file_path}: ${errorMessage}`);
        const absPath = path.isAbsolute(file.file_path)
          ? file.file_path
          : path.join(finalDirectory, file.file_path);
        failedFiles.push({ filePath: file.file_path, absolutePath: absPath, error: errorMessage });
      }
    }

    console.log("All file changes processed. Succeeded:", succeededFiles.length, "Failed:", failedFiles.length);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred in applyChangesAction';
    console.error('Error in applyChangesAction:', errorMessage);
    failedFiles.push({ filePath: 'N/A', absolutePath: 'N/A', error: errorMessage });
  }

  return { succeededFiles, failedFiles };
}