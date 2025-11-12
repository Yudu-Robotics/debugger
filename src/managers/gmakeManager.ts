import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { DownloadUtils } from "../utils/downloadUtils";

export interface GmakeSetupProgress {
  stage: "downloading" | "configuring" | "validating" | "complete" | "error";
  progress: number;
  message: string;
}

export interface GmakeInfo {
  version: string;
  path: string;
  isInstalled: boolean;
  executablePath?: string;
}

// GCP download URLs for gmake binaries
const GMAKE_DOWNLOAD_URLS = {
  darwin_arm64: "https://storage.googleapis.com/port11/gmake_mac_aarchx64",
  darwin_x64: "https://storage.googleapis.com/port11/gmake_mac_aarchx64",
  win32_x64: "https://storage.googleapis.com/port11/gmake_win_x86_64.exe",
  linux_x64: "https://storage.googleapis.com/port11/gmake_linux_x86_64",
  linux_arm64: "https://storage.googleapis.com/port11/gmake_linux_x86_64",
};

const GMAKE_EXECUTABLE_NAME = "gmake";

export class GmakeManager {
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.OutputChannel;
  private readonly GMAKE_EXECUTABLE_KEY = "mspm0.gmakeExecutablePath";

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
  }

  private async saveGmakePath(executablePath: string): Promise<void> {
    try {
      await this.context.globalState.update(
        this.GMAKE_EXECUTABLE_KEY,
        executablePath
      );
      this.outputChannel.appendLine(`Saved gmake path: ${executablePath}`);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to save gmake path: ${error}`);
    }
  }

  private getInstallPath(): string {
    const fileName =
      process.platform === "win32"
        ? `${GMAKE_EXECUTABLE_NAME}.exe`
        : GMAKE_EXECUTABLE_NAME;
    return path.join(DownloadUtils.getBaseInstallPath(), fileName);
  }

  private getDownloadUrl(): string {
    const platform = process.platform;
    const arch = process.arch;
    const platformKey =
      `${platform}_${arch}` as keyof typeof GMAKE_DOWNLOAD_URLS;

    // Return the URL for the platform-arch combination, fallback to linux_x64
    return GMAKE_DOWNLOAD_URLS[platformKey] || GMAKE_DOWNLOAD_URLS.linux_x64;
  }

  async isGmakeInstalled(): Promise<boolean> {
    try {
      const gmakeInfo = await this.getGmakeInfo();
      return gmakeInfo.isInstalled;
    } catch (error) {
      this.outputChannel.appendLine(
        `Error checking gmake installation: ${error}`
      );
      return false;
    }
  }

  async getGmakeInfo(): Promise<GmakeInfo> {
    const defaultInfo: GmakeInfo = {
      version: "Not installed",
      path: DownloadUtils.getBaseInstallPath(),
      isInstalled: false,
    };

    try {
      const gmakeExecutable = this.getGmakePath();

      if (gmakeExecutable) {
        const version = await this.getGmakeVersion(gmakeExecutable);
        await this.saveGmakePath(gmakeExecutable);

        return {
          version,
          path: path.dirname(gmakeExecutable),
          isInstalled: true,
          executablePath: gmakeExecutable,
        };
      }

      return defaultInfo;
    } catch (error) {
      this.outputChannel.appendLine(`Error getting gmake info: ${error}`);
      return defaultInfo;
    }
  }

  getGmakePath(): string | undefined {
    try {
      this.outputChannel.appendLine("Searching for gmake...");

      // Check install path (YuduRobotics/plugins/gmake)
      const installPath = this.getInstallPath();
      if (fs.existsSync(installPath)) {
        this.outputChannel.appendLine(
          `Found gmake in install path: ${installPath}`
        );
        return installPath;
      } else {
        this.outputChannel.appendLine(
          `gmake not found in install path: ${installPath}. Initiating installation...`
        );
        this.installGmake((gmakeProgress) => {
          this.outputChannel.appendLine(
            `[gmake Install] ${
              gmakeProgress.message
            } (${gmakeProgress.progress.toFixed(1)}%)`
          );
        })
          .then(() => {
            this.outputChannel.appendLine(`gmake installed at: ${installPath}`);
            return installPath;
          })
          .catch((error) => {
            this.outputChannel.appendLine(`Failed to install gmake: ${error}`);
            return undefined;
          });
      }
    } catch (error) {
      this.outputChannel.appendLine(`Error getting gmake path: ${error}`);
      return undefined;
    }
  }

  async installGmake(
    progressCallback?: (progress: GmakeSetupProgress) => void
  ): Promise<void> {
    const installPath = this.getInstallPath();

    try {
      // Create install directory
      const installDir = path.dirname(installPath);
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true });
        this.outputChannel.appendLine(
          `Created install directory: ${installDir}`
        );
      }

      // Download file
      progressCallback?.({
        stage: "downloading",
        progress: 10,
        message: "Downloading gmake from GCP...",
      });

      const platform = process.platform;
      const arch = process.arch;
      const downloadUrl = this.getDownloadUrl();
      this.outputChannel.appendLine(
        `Platform: ${platform}, Architecture: ${arch}`
      );
      this.outputChannel.appendLine(`Downloading from: ${downloadUrl}`);

      await this.downloadFile(downloadUrl, installPath, (progress) => {
        progressCallback?.({
          stage: "downloading",
          progress: 10 + progress * 0.8,
          message: `Downloading gmake... ${progress.toFixed(1)}%`,
        });
      });

      // Make executable (Unix-like systems only)
      if (process.platform !== "win32") {
        progressCallback?.({
          stage: "configuring",
          progress: 95,
          message: "Setting permissions...",
        });
        fs.chmodSync(installPath, "755");
      }

      // Save path
      await this.saveGmakePath(installPath);

      progressCallback?.({
        stage: "complete",
        progress: 100,
        message: "gmake installation complete",
      });

      this.outputChannel.appendLine(
        `gmake installed successfully at: ${installPath}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `gmake installation failed: ${errorMessage}`
      );

      // Clean up partial download
      if (fs.existsSync(installPath)) {
        try {
          fs.unlinkSync(installPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      progressCallback?.({
        stage: "error",
        progress: 0,
        message: `Installation failed: ${errorMessage}`,
      });

      throw error;
    }
  }

  private downloadFile(
    url: string,
    destPath: string,
    progressCallback?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Handle redirect
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.downloadFile(redirectUrl, destPath, progressCallback)
                .then(resolve)
                .catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(
              new Error(`Failed to download: HTTP ${response.statusCode}`)
            );
            return;
          }

          const totalBytes = parseInt(
            response.headers["content-length"] || "0",
            10
          );
          let downloadedBytes = 0;

          const fileStream = fs.createWriteStream(destPath);

          response.on("data", (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0 && progressCallback) {
              const progress = (downloadedBytes / totalBytes) * 100;
              progressCallback(progress);
            }
          });

          response.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close();
            resolve();
          });

          fileStream.on("error", (error) => {
            fs.unlinkSync(destPath);
            reject(error);
          });
        })
        .on("error", (error) => {
          reject(error);
        });
    });
  }

  private async getGmakeVersion(executablePath: string): Promise<string> {
    const { spawn } = require("child_process");

    return new Promise((resolve) => {
      const versionProcess = spawn(executablePath, ["--version"]);
      let output = "";

      versionProcess.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });

      versionProcess.on("close", () => {
        const versionMatch = output.match(/GNU Make (\d+\.\d+(?:\.\d+)?)/i);
        if (versionMatch) {
          resolve(versionMatch[1]);
        } else {
          resolve("Unknown");
        }
      });

      versionProcess.on("error", () => {
        resolve("Unknown");
      });

      setTimeout(() => {
        versionProcess.kill();
        resolve("Unknown");
      }, 5000);
    });
  }
}
