# DG RefHelp Pathways Site

React + Vite frontend for referral pathways and evidence summaries.

The site discovers the latest pathway bundles from:

- `https://github.com/fergusdonachie/dgrefhelp-pathways`

It loads:

- `outputs/cms-upload-bundle.json` for pathway structure and HTML content
- `drafts/review-pack.md` for the evidence summary

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Vercel

This repo is ready to deploy on Vercel as a static Vite project.

Recommended settings:

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

No environment variables are required.

Recommended for production:

- `GITHUB_TOKEN` - a GitHub personal access token with read access to the content repository, used by the Vercel serverless function to avoid GitHub API rate limits.

## Content model

At runtime the app:

1. Reads the GitHub repository tree through the GitHub API.
2. Finds the latest `cms-upload-bundle.json` for each pathway slug.
3. Fetches the matching review pack markdown.
4. Renders the pathway summary, accordion sections, and evidence panel.

## Key files

- `src/App.jsx` - data loading and UI
- `src/styles.css` - visual design
- `vercel.json` - deployment configuration
