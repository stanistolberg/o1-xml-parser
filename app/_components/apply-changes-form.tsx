"use client";
import { applyChangesAction } from "@/actions/apply-changes-actions";
import { useEffect, useState } from "react";

const STORAGE_KEY = "o1-xml-parser-minicache";
const HISTORY_KEY = "o1-xml-parser-history";

interface FileResult {
  filePath: string;
  absolutePath: string;
  error?: string;
}

interface RunResult {
  timestamp: number;
  succeededFiles: FileResult[];
  failedFiles: FileResult[];
}

export function ApplyChangesForm() {
  const [xml, setXml] = useState<string>("");
  const [projectDirectory, setProjectDirectory] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(STORAGE_KEY) || "";
  });
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [preserveXml, setPreserveXml] = useState(false);

  const [currentSucceededFiles, setCurrentSucceededFiles] = useState<FileResult[]>([]);
  const [currentFailedFiles, setCurrentFailedFiles] = useState<FileResult[]>([]);

  const [runHistory, setRunHistory] = useState<RunResult[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (successMessage) {
      timer = setTimeout(() => {
        setSuccessMessage("");
      }, 2000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [successMessage]);

  const handleApply = async () => {
    setErrorMessage("");
    setCurrentSucceededFiles([]);
    setCurrentFailedFiles([]);
    if (!xml.trim()) {
      setErrorMessage("Please paste XML before applying changes.");
      return;
    }
    try {
      const trimmedDirectory = projectDirectory.trim();
      const result = await applyChangesAction(xml, trimmedDirectory);
      localStorage.setItem(STORAGE_KEY, trimmedDirectory);

      const newRun: RunResult = {
        timestamp: Date.now(),
        succeededFiles: result.succeededFiles,
        failedFiles: result.failedFiles
      };

      // Store this run in history
      const updatedHistory = [...runHistory, newRun];
      setRunHistory(updatedHistory);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));

      // Check results
      const totalProcessed = result.succeededFiles.length + result.failedFiles.length;
      if (result.failedFiles.length > 0) {
        setCurrentFailedFiles(result.failedFiles);
        setCurrentSucceededFiles(result.succeededFiles);
        setErrorMessage(`Processed ${totalProcessed} files: ${result.succeededFiles.length} succeeded, ${result.failedFiles.length} failed.`);
      } else {
        setCurrentSucceededFiles(result.succeededFiles);
        setSuccessMessage(`All ${result.succeededFiles.length} files processed successfully.`);
        if (!preserveXml) {
          setXml("");
        }
      }

    } catch (error: any) {
      setErrorMessage("An error occurred while applying changes.");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-start justify-center p-4">
      <div className="max-w-xl w-full flex flex-col gap-4">
        {errorMessage && <div className="text-red-400">{errorMessage}</div>}
        {successMessage && <div className="text-green-400">{successMessage}</div>}

        {/* Display counts */}
        {(currentSucceededFiles.length > 0 || currentFailedFiles.length > 0) && (
          <div className="text-sm text-gray-300">
            <p>
              Total processed: {currentSucceededFiles.length + currentFailedFiles.length}, 
              Succeeded: {currentSucceededFiles.length}, 
              Failed: {currentFailedFiles.length}
            </p>
          </div>
        )}

        {/* Display succeeded files */}
        {currentSucceededFiles.length > 0 && (
          <div className="text-green-400">
            <h3 className="font-bold mb-2">Succeeded Files:</h3>
            <ul className="list-disc list-inside">
              {currentSucceededFiles.map((f, idx) => (
                <li key={idx}>
                  <strong>{f.filePath}</strong> → {f.absolutePath}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Display failed files */}
        {currentFailedFiles.length > 0 && (
          <div className="text-red-400">
            <h3 className="font-bold mb-2">Failed Files:</h3>
            <ul className="list-disc list-inside">
              {currentFailedFiles.map((f, idx) => (
                <li key={idx}>
                  <strong>{f.filePath}</strong> → {f.absolutePath}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col">
          <label className="mb-2 font-bold">Project Directory:</label>
          <input
            className="border bg-secondary text-secondary-foreground p-2 w-full rounded-md"
            type="text"
            value={projectDirectory}
            onChange={(e) => setProjectDirectory(e.target.value)}
            placeholder="e.g. /Users/myusername/projects/o1-xml-parser"
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-2 font-bold">Paste XML here:</label>
          <textarea
            className="border bg-secondary text-secondary-foreground p-2 h-64 w-full rounded-md"
            value={xml}
            onChange={(e) => setXml(e.target.value)}
            placeholder="Paste the <code_changes>...</code_changes> XML here"
          />
        </div>

        <button
          className="bg-primary text-primary-foreground p-2 rounded-md hover:bg-primary/90 transition-colors"
          onClick={handleApply}
        >
          Apply
        </button>

        <div className="flex items-center justify-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
          <input
            type="checkbox"
            id="preserve-xml"
            checked={preserveXml}
            onChange={(e) => setPreserveXml(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          <label htmlFor="preserve-xml" className="text-sm cursor-pointer select-none">
            Preserve XML after applying
          </label>
        </div>

        {/* Display run history */}
        {runHistory.length > 0 && (
          <div className="mt-8">
            <h3 className="font-bold text-lg">Run History</h3>
            {runHistory.map((run, runIndex) => {
              const totalProcessed = run.succeededFiles.length + run.failedFiles.length;
              return (
                <div key={runIndex} className="mt-4 border p-2 rounded-md">
                  <div className="text-sm mb-2">
                    <strong>Run Timestamp:</strong> {new Date(run.timestamp).toLocaleString()}
                  </div>
                  <p className="text-sm mb-2 text-gray-300">
                    Processed {totalProcessed} file(s), {run.succeededFiles.length} succeeded, {run.failedFiles.length} failed.
                  </p>
                  {run.succeededFiles.length > 0 && (
                    <div className="text-green-400 mb-2">
                      <h4 className="font-bold">Succeeded Files:</h4>
                      <ul className="list-disc list-inside">
                        {run.succeededFiles.map((f, idx) => (
                          <li key={idx}>
                            <strong>{f.filePath}</strong> → {f.absolutePath}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {run.failedFiles.length > 0 && (
                    <div className="text-red-400">
                      <h4 className="font-bold">Failed Files:</h4>
                      <ul className="list-disc list-inside">
                        {run.failedFiles.map((f, idx) => (
                          <li key={idx}>
                            <strong>{f.filePath}</strong> → {f.absolutePath}{f.error ? `: ${f.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}