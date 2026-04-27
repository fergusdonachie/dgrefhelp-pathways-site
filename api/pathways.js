const REPO_OWNER = 'fergusdonachie'
const REPO_NAME = 'dgrefhelp-pathways'
const API_ROOT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`

function safeText(value) {
  return typeof value === 'string' ? value : ''
}

function stripHtml(html) {
  return safeText(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatPathwayName(slug) {
  return safeText(slug)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) {
    return []
  }

  return sections
    .map((section, index) => ({
      heading:
        typeof section?.heading === 'string' && section.heading.trim()
          ? section.heading
          : `Section ${index + 1}`,
      html: safeText(section?.html),
    }))
    .filter((section) => section.html.trim())
}

function groupBundlesByPathway(paths) {
  const bundlesByPathway = new Map()

  for (const path of paths) {
    const match = path.match(/^pathways\/([^/]+)\/([^/]+)\/outputs\/cms-upload-bundle\.json$/)
    if (!match) {
      continue
    }

    const [, pathwaySlug, version] = match
    const current = bundlesByPathway.get(pathwaySlug) || []
    current.push({ pathwaySlug, version, bundlePath: path })
    bundlesByPathway.set(pathwaySlug, current)
  }

  return bundlesByPathway
}

function parseVersionTimestamp(version) {
  const match = safeText(version).match(/^(\d{8})-(\d{4})(?:-v(\d+))?$/i)
  if (!match) {
    return null
  }

  const [, datePart, timePart, revision = '0'] = match
  const year = Number(datePart.slice(0, 4))
  const month = Number(datePart.slice(4, 6)) - 1
  const day = Number(datePart.slice(6, 8))
  const hours = Number(timePart.slice(0, 2))
  const minutes = Number(timePart.slice(2, 4))
  const revisionNumber = Number(revision)

  return {
    sortValue: Date.UTC(year, month, day, hours, minutes),
    revision: Number.isFinite(revisionNumber) ? revisionNumber : 0,
  }
}

function compareByVersionName(left, right) {
  const leftParsed = parseVersionTimestamp(left.version)
  const rightParsed = parseVersionTimestamp(right.version)

  if (leftParsed && rightParsed) {
    if (leftParsed.sortValue !== rightParsed.sortValue) {
      return rightParsed.sortValue - leftParsed.sortValue
    }

    if (leftParsed.revision !== rightParsed.revision) {
      return rightParsed.revision - leftParsed.revision
    }
  } else if (leftParsed || rightParsed) {
    return leftParsed ? -1 : 1
  }

  return right.version.localeCompare(left.version)
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dgrefhelp-pathways-site',
  }

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  return headers
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders() })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return response.json()
}

async function fetchText(url) {
  const response = await fetch(url, { headers: githubHeaders() })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return response.text()
}

function rawUrl(branch, path) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}/${path}`
}

async function fetchLatestCommitTimestamp(branch, path) {
  const commits = await fetchJson(
    `${API_ROOT}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`,
  )

  const commitDate = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date
  const timestamp = commitDate ? Date.parse(commitDate) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

async function sortBundleCandidates(candidates, branch) {
  if (candidates.length <= 1) {
    return candidates
  }

  const sortedCandidates = [...candidates].sort(compareByVersionName)
  const needsCommitFallback = sortedCandidates.some((candidate, index) => {
    if (index === 0) {
      return !parseVersionTimestamp(candidate.version)
    }

    const previous = sortedCandidates[index - 1]
    const candidateParsed = parseVersionTimestamp(candidate.version)
    const previousParsed = parseVersionTimestamp(previous.version)

    if (!candidateParsed || !previousParsed) {
      return true
    }

    return (
      candidateParsed.sortValue === previousParsed.sortValue &&
      candidateParsed.revision === previousParsed.revision
    )
  })

  if (!needsCommitFallback) {
    return sortedCandidates
  }

  const commitTimes = await Promise.all(
    sortedCandidates.map(async (candidate) => ({
      ...candidate,
      commitTimestamp: await fetchLatestCommitTimestamp(branch, candidate.bundlePath),
    })),
  )

  commitTimes.sort((left, right) => {
    if (right.commitTimestamp !== left.commitTimestamp) {
      return right.commitTimestamp - left.commitTimestamp
    }

    return compareByVersionName(left, right)
  })

  return commitTimes
}

async function loadBundleGroups(paths, branch) {
  const bundlesByPathway = groupBundlesByPathway(paths)

  const groupedCandidates = await Promise.all(
    [...bundlesByPathway.entries()].map(async ([pathwaySlug, candidates]) => ({
      pathwaySlug,
      candidates: await sortBundleCandidates(candidates, branch),
    })),
  )

  return groupedCandidates.sort((left, right) =>
    formatPathwayName(left.pathwaySlug).localeCompare(formatPathwayName(right.pathwaySlug)),
  )
}

async function resolveBundleContent(branch, bundle) {
  let summaryHtml = safeText(bundle?.page_contents_html)
  let sections = normalizeSections(bundle?.accordion_sections)

  if (!summaryHtml && typeof bundle?.page_contents_html_path === 'string') {
    summaryHtml = await fetchText(rawUrl(branch, bundle.page_contents_html_path))
  }

  if (!sections.length && typeof bundle?.accordion_sections_json_path === 'string') {
    const sectionData = await fetchJson(rawUrl(branch, bundle.accordion_sections_json_path))
    sections = normalizeSections(sectionData?.accordion_sections || sectionData)
  }

  return { summaryHtml, sections }
}

async function discoverPathways() {
  const repository = await fetchJson(API_ROOT)
  const branch = repository.default_branch
  const tree = await fetchJson(`${API_ROOT}/git/trees/${branch}?recursive=1`)
  const blobPaths = tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path)
  const bundleGroups = await loadBundleGroups(blobPaths, branch)

  const pathways = await Promise.all(
    bundleGroups.map(async ({ pathwaySlug, candidates }) => {
      const versions = (
        await Promise.all(
          candidates.map(async ({ version, bundlePath }) => {
            try {
              const bundle = await fetchJson(rawUrl(branch, bundlePath))
              const reviewPackPath = `pathways/${pathwaySlug}/${version}/drafts/review-pack.md`
              let reviewPack = ''

              try {
                reviewPack = await fetchText(rawUrl(branch, reviewPackPath))
              } catch {
                reviewPack = ''
              }

              const resolvedContent = await resolveBundleContent(branch, bundle)
              const summaryHtml = resolvedContent.summaryHtml
              const sections = resolvedContent.sections

              return {
                id: `${pathwaySlug}:${version}`,
                slug: pathwaySlug,
                title: formatPathwayName(pathwaySlug),
                topic:
                  typeof bundle?.topic === 'string' && bundle.topic.trim()
                    ? bundle.topic
                    : formatPathwayName(pathwaySlug),
                version,
                summaryText: stripHtml(summaryHtml),
                summaryHtml,
                sections,
                reviewPack: safeText(reviewPack),
                rawBundlePath: bundlePath,
                branch,
              }
            } catch (error) {
              console.warn(`Skipping malformed pathway bundle: ${bundlePath}`, error)
              return null
            }
          }),
        )
      ).filter(Boolean)

      if (!versions.length) {
        return null
      }

      return {
        id: pathwaySlug,
        slug: pathwaySlug,
        title: formatPathwayName(pathwaySlug),
        topic: versions[0].topic,
        summaryText: versions[0].summaryText,
        versions,
      }
    }),
  )

  return pathways.filter(Boolean)
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=86400')

  try {
    const pathways = await discoverPathways()
    response.status(200).json({ pathways })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
}
