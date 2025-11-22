import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// GitHub repository details - update these to match your repo
const GITHUB_OWNER = 'ADA-Markets';
const GITHUB_REPO = 'FetcherBot';
const GITHUB_BRANCH = 'main';

interface VersionInfo {
  currentVersion: string;
  currentCommit: string | null;
  latestCommit: string | null;
  latestCommitDate: string | null;
  latestCommitMessage: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  repoUrl: string;
}

/**
 * GET /api/version - Check current version and latest GitHub commit
 */
export async function GET() {
  try {
    // Get current version from package.json
    let currentVersion = '1.0.0';
    try {
      const packagePath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      currentVersion = packageJson.version || '1.0.0';
    } catch (e) {
      console.error('[Version API] Failed to read package.json:', e);
    }

    // Get current commit from .git/HEAD or environment
    let currentCommit: string | null = null;
    try {
      // Try reading from .git directory
      const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();

        if (headContent.startsWith('ref:')) {
          // HEAD points to a branch, read the ref file
          const refPath = headContent.replace('ref: ', '');
          const fullRefPath = path.join(process.cwd(), '.git', refPath);
          if (fs.existsSync(fullRefPath)) {
            currentCommit = fs.readFileSync(fullRefPath, 'utf8').trim().slice(0, 7);
          }
        } else {
          // HEAD is a detached commit
          currentCommit = headContent.slice(0, 7);
        }
      }
    } catch (e) {
      console.error('[Version API] Failed to read git commit:', e);
    }

    // Try to get latest commit from GitHub API
    let latestCommit: string | null = null;
    let latestCommitDate: string | null = null;
    let latestCommitMessage: string | null = null;
    let checkError: string | null = null;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'FetcherBot',
          },
          // Short timeout for version check
          signal: AbortSignal.timeout(5000),
        }
      );

      if (response.ok) {
        const data = await response.json();
        latestCommit = data.sha?.slice(0, 7) || null;
        latestCommitDate = data.commit?.committer?.date || null;
        latestCommitMessage = data.commit?.message?.split('\n')[0] || null; // First line only
      } else if (response.status === 404) {
        checkError = 'Repository not found. Check GitHub settings.';
      } else if (response.status === 403) {
        checkError = 'GitHub API rate limit exceeded. Try again later.';
      } else {
        checkError = `GitHub API error: ${response.status}`;
      }
    } catch (e: any) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        checkError = 'GitHub API timeout. Check your connection.';
      } else {
        checkError = `Failed to check updates: ${e.message}`;
      }
    }

    // Determine if update is available
    const updateAvailable = Boolean(
      currentCommit &&
      latestCommit &&
      currentCommit !== latestCommit
    );

    const versionInfo: VersionInfo = {
      currentVersion,
      currentCommit,
      latestCommit,
      latestCommitDate,
      latestCommitMessage,
      updateAvailable,
      checkError,
      repoUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
    };

    return NextResponse.json({
      success: true,
      ...versionInfo,
    });
  } catch (error: any) {
    console.error('[Version API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        currentVersion: '1.0.0',
        currentCommit: null,
        latestCommit: null,
        updateAvailable: false,
      },
      { status: 500 }
    );
  }
}
