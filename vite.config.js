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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
