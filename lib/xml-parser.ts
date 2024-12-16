import { DOMParser, Node } from "@xmldom/xmldom";

interface ParsedFileChange {
  file_summary: string;
  file_operation: string;
  file_path: string;
  file_code?: string;
}

/**
 * A fully hardened parser:
 * - Handles multiple <changed_files> blocks inside <code_changes>.
 * - Handles multiple <file> elements inside each <changed_files>.
 * - Handles legacy style without <file> elements:
 *   * Now supports multiple legacy files per <changed_files> by repeatedly scanning for 
 *     file_summary/file_operation/file_path/file_code sets in sequence.
 * - Extracts CDATA from <file_code> if present.
 * - Validates all required fields and logs errors if missing.
 * - Returns all valid file changes.
 */
export async function parseXmlString(xmlString: string): Promise<ParsedFileChange[] | null> {
  try {
    if (!xmlString || !xmlString.trim()) {
      throw new Error("Empty XML string provided");
    }

    xmlString = xmlString.trim();
    console.log("Processing XML input, first 500 chars:", xmlString.substring(0, 500) + "...");

    if (!xmlString.includes("<code_changes>") || !xmlString.includes("</code_changes>")) {
      throw new Error("XML must have a <code_changes> root element with proper closing tag.");
    }

    const parser = new DOMParser({
      locator: true,
      errorHandler: (level: string, msg: string) => {
        if (level === "error" || level === "fatal") {
          console.error("XML Parser Error:", msg);
        }
      },
    });

    const doc = parser.parseFromString(xmlString, "text/xml");
    if (!doc || !doc.documentElement) {
      throw new Error("Failed to parse XML document - documentElement is missing.");
    }

    if (doc.documentElement.nodeName !== "code_changes") {
      throw new Error("Root element must be <code_changes>");
    }

    const changedFilesNodes = doc.getElementsByTagName("changed_files");
    if (!changedFilesNodes || changedFilesNodes.length === 0) {
      throw new Error("No <changed_files> elements found inside <code_changes>");
    }

    const allChanges: ParsedFileChange[] = [];

    // Extracts code from file_code node, handling CDATA if present
    const extractFileCode = (fileCodeNode: Node): string | undefined => {
      for (let k = 0; k < fileCodeNode.childNodes.length; k++) {
        const codeNode = fileCodeNode.childNodes.item(k);
        if (codeNode && codeNode.nodeType === 4) { // CDATA_SECTION_NODE
          return codeNode.nodeValue?.trim();
        }
      }
      return fileCodeNode.textContent?.trim() || undefined;
    };

    // Process a <file> element node
    const processFileElement = (fileNode: Node): ParsedFileChange | null => {
      const fileChange: Partial<ParsedFileChange> = {};

      for (let fc = 0; fc < fileNode.childNodes.length; fc++) {
        const subNode = fileNode.childNodes.item(fc);
        if (subNode && subNode.nodeType === 1) { // ELEMENT_NODE
          const name = subNode.nodeName;
          const text = subNode.textContent?.trim() ?? "";
          switch (name) {
            case "file_summary":
              fileChange.file_summary = text;
              break;
            case "file_operation":
              fileChange.file_operation = text.toUpperCase();
              break;
            case "file_path":
              fileChange.file_path = text;
              break;
            case "file_code":
              fileChange.file_code = extractFileCode(subNode);
              break;
          }
        }
      }

      // Validate fields
      if (!fileChange.file_summary || !fileChange.file_operation || !fileChange.file_path) {
        console.error("A <file> element is missing required fields: file_summary, file_operation, or file_path.");
        return null;
      }

      if (!["CREATE", "UPDATE", "DELETE"].includes(fileChange.file_operation)) {
        console.error(`Invalid file_operation: ${fileChange.file_operation} for file: ${fileChange.file_path}`);
        return null;
      }

      if (["CREATE", "UPDATE"].includes(fileChange.file_operation) && !fileChange.file_code) {
        console.error(`Missing file_code for ${fileChange.file_operation} operation on ${fileChange.file_path}`);
        return null;
      }

      return fileChange as ParsedFileChange;
    };

    // Process legacy files from a changed_files node by scanning multiple sets
    const processLegacyFiles = (changedFilesNode: Node): ParsedFileChange[] => {
      const legacyChanges: ParsedFileChange[] = [];

      // We'll gather ELEMENT_NODE children
      const elements: Node[] = [];
      for (let i = 0; i < changedFilesNode.childNodes.length; i++) {
        const n = changedFilesNode.childNodes.item(i);
        if (n && n.nodeType === 1) { // ELEMENT_NODE
          elements.push(n);
        }
      }

      // We now scan elements repeatedly looking for patterns:
      // file_summary -> file_operation -> file_path -> file_code
      // Once we get a full set, we push that file change and continue scanning
      // There might be multiple sets in sequence.
      let idx = 0;
      while (idx < elements.length) {
        let file_summary: string | undefined;
        let file_operation: string | undefined;
        let file_path: string | undefined;
        let file_code: string | undefined;

        // look for file_summary
        if (idx < elements.length && elements[idx].nodeName === "file_summary") {
          file_summary = elements[idx].textContent?.trim();
          idx++;
        } else {
          // If we don't start with file_summary, no more files in legacy mode
          break;
        }

        // file_operation
        if (idx < elements.length && elements[idx].nodeName === "file_operation") {
          file_operation = elements[idx].textContent?.trim().toUpperCase();
          idx++;
        } else {
          console.warn("Legacy file incomplete: missing file_operation after file_summary");
          break;
        }

        // file_path
        if (idx < elements.length && elements[idx].nodeName === "file_path") {
          file_path = elements[idx].textContent?.trim();
          idx++;
        } else {
          console.warn("Legacy file incomplete: missing file_path after file_operation");
          break;
        }

        // file_code
        if (idx < elements.length && elements[idx].nodeName === "file_code") {
          file_code = extractFileCode(elements[idx]);
          idx++;
        } else {
          console.warn("Legacy file incomplete: missing file_code after file_path");
          break;
        }

        // Validate this file
        if (!file_summary || !file_operation || !file_path) {
          console.warn("Legacy file incomplete: missing required fields");
          continue;
        }

        if (!["CREATE", "UPDATE", "DELETE"].includes(file_operation)) {
          console.error(`Invalid file_operation: ${file_operation}. Must be CREATE, UPDATE, or DELETE.`);
          continue;
        }

        if (["CREATE", "UPDATE"].includes(file_operation) && !file_code) {
          console.error(`Missing file_code for ${file_operation} on ${file_path}`);
          continue;
        }

        // All good, push this file
        legacyChanges.push({
          file_summary,
          file_operation,
          file_path,
          file_code
        });
      }

      if (legacyChanges.length === 0) {
        console.warn("No valid legacy files found in this <changed_files> block.");
      }

      return legacyChanges;
    };

    // Process each changed_files block
    for (let c = 0; c < changedFilesNodes.length; c++) {
      const changedFilesNode = changedFilesNodes.item(c);
      if (!changedFilesNode) continue;

      const fileNodes = changedFilesNode.getElementsByTagName("file");

      if (fileNodes.length > 0) {
        // multiple <file> elements scenario
        for (let f = 0; f < fileNodes.length; f++) {
          const fileNode = fileNodes.item(f);
          if (!fileNode) continue;
          const parsed = processFileElement(fileNode);
          if (parsed) {
            allChanges.push(parsed);
          }
        }
      } else {
        // Legacy scenario: try to parse multiple files inline
        const legacyFiles = processLegacyFiles(changedFilesNode);
        allChanges.push(...legacyFiles);
      }
    }

    if (allChanges.length === 0) {
      throw new Error("No valid file changes found in the provided XML. Check formatting and required elements.");
    }

    console.log(`Successfully parsed ${allChanges.length} file changes from the XML.`);
    return allChanges;
  } catch (error: unknown) {
    console.error("Error parsing XML:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to parse XML: Unknown error");
  }
}