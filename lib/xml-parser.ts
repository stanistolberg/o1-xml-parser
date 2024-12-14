import { DOMParser, Node } from "@xmldom/xmldom";

interface ParsedFileChange {
  file_summary: string;
  file_operation: string;
  file_path: string;
  file_code?: string;
}

/**
 * A fully hardened parser to handle:
 * - Multiple <changed_files> blocks inside <code_changes>
 * - Multiple <file> elements inside each <changed_files>
 * - Legacy style without <file> but with direct <file_summary>, <file_operation>, <file_path>, and <file_code>
 * - Properly extracts CDATA from <file_code>, if present
 * - Validates all required fields and logs appropriate errors
 * - Returns all valid file changes without skipping any
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

    // Processes a <file> element node
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

    // Process each changed_files block
    for (let c = 0; c < changedFilesNodes.length; c++) {
      const changedFilesNode = changedFilesNodes.item(c);
      if (!changedFilesNode) continue;

      const fileNodes = changedFilesNode.getElementsByTagName("file");
      if (fileNodes.length > 0) {
        // Multiple <file> elements scenario
        for (let f = 0; f < fileNodes.length; f++) {
          const fileNode = fileNodes.item(f);
          if (!fileNode) continue;
          const parsed = processFileElement(fileNode);
          if (parsed) {
            allChanges.push(parsed);
          }
        }
      } else {
        // Legacy scenario: fields directly under <changed_files>
        const legacyFile: Partial<ParsedFileChange> = {};
        let fileCodeNode: Node | null = null;

        for (let i = 0; i < changedFilesNode.childNodes.length; i++) {
          const node = changedFilesNode.childNodes.item(i);
          if (node && node.nodeType === 1) {
            const nodeName = node.nodeName;
            const text = node.textContent?.trim() ?? "";
            switch (nodeName) {
              case "file_summary":
                legacyFile.file_summary = text;
                break;
              case "file_operation":
                legacyFile.file_operation = text.toUpperCase();
                break;
              case "file_path":
                legacyFile.file_path = text;
                break;
              case "file_code":
                fileCodeNode = node;
                break;
            }
          }
        }

        if (fileCodeNode) {
          legacyFile.file_code = extractFileCode(fileCodeNode);
        }

        // Validate legacy file
        if (!legacyFile.file_summary || !legacyFile.file_operation || !legacyFile.file_path) {
          console.warn("Legacy <changed_files> missing required fields or no <file> tags present. Skipping this block.");
          continue;
        }

        if (!["CREATE", "UPDATE", "DELETE"].includes(legacyFile.file_operation)) {
          console.error(`Invalid file_operation: ${legacyFile.file_operation}. Must be CREATE, UPDATE, or DELETE.`);
          continue;
        }

        if (["CREATE", "UPDATE"].includes(legacyFile.file_operation) && !legacyFile.file_code) {
          console.error(`Missing file_code for ${legacyFile.file_operation} operation on ${legacyFile.file_path}`);
          continue;
        }

        allChanges.push(legacyFile as ParsedFileChange);
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