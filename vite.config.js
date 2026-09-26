import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Which build am I looking at?
//
// Three rounds in a row were spent working out whether a change had deployed yet, on a
// phone, by hunting for a sentence that was supposed to have changed. The deploy was
// always fine; the question was unanswerable from the screen. So the build stamps itself.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA during a build and does not ship a .git directory, so
// git is only consulted locally. 'dev' when neither is available — a dev server has no
// commit worth naming, and a build that cannot identify itself should say so rather than
// print something confident and wrong.
function buildSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

const BUILD_SHA = buildSha()
const BUILD_TIME = new Date().toISOString()

// The same stamp, published beside the app as /version.json, so a tab that has been open
// since before a deploy can ask the server what is live now and notice it is behind. A
// single-page app never reloads itself: without this, a phone left open overnight keeps
// running yesterday's code through logouts and logins until someone closes the tab.
// See src/components/VersionWatcher.jsx.
function emitVersionFile() {
  return {
    name: 'byond-emit-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ sha: BUILD_SHA, builtAt: BUILD_TIME }),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    emitVersionFile(),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
