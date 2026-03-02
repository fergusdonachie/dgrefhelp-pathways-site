import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const REPO_OWNER = 'fergusdonachie'
const REPO_NAME = 'dgrefhelp-pathways'
const API_ROOT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`

marked.setOptions({
  breaks: true,
  gfm: true,
})

function formatPathwayName(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function safeText(value) {
  return typeof value === 'string' ? value : ''
}

function stripHtml(html) {
  return safeText(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

async function fetchLatestCommitTimestamp(branch, path) {
  const commits = await fetchJson(
    `${API_ROOT}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`,
  )

  const commitDate = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date
  const timestamp = commitDate ? Date.parse(commitDate) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

async function pickLatestBundles(paths, branch) {
  const bundlesByPathway = groupBundlesByPathway(paths)

  const selectedBundles = await Promise.all(
    [...bundlesByPathway.values()].map(async (candidates) => {
      if (candidates.length === 1) {
        return candidates[0]
      }

      const sortedCandidates = [...candidates].sort(compareByVersionName)
      const [first, second] = sortedCandidates
      const firstParsed = parseVersionTimestamp(first.version)
      const secondParsed = parseVersionTimestamp(second.version)

      if (
        firstParsed &&
        secondParsed &&
        (firstParsed.sortValue !== secondParsed.sortValue || firstParsed.revision !== secondParsed.revision)
      ) {
        return first
      }

      const commitTimes = await Promise.all(
        sortedCandidates.map(async (candidate) => ({
          candidate,
          commitTimestamp: await fetchLatestCommitTimestamp(branch, candidate.bundlePath),
        })),
      )

      commitTimes.sort((left, right) => {
        if (right.commitTimestamp !== left.commitTimestamp) {
          return right.commitTimestamp - left.commitTimestamp
        }

        return compareByVersionName(left.candidate, right.candidate)
      })

      return commitTimes[0].candidate
    }),
  )

  return selectedBundles.sort((left, right) =>
    formatPathwayName(left.pathwaySlug).localeCompare(formatPathwayName(right.pathwaySlug)),
  )
}

async function fetchJson(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return response.json()
}

async function fetchText(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return response.text()
}

function rawUrl(branch, path) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}/${path}`
}

function parseLocation() {
  const { pathname, search } = window.location
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const searchParams = new URLSearchParams(search)

  if (segments[0] === 'pathway' && segments[1]) {
    const view = searchParams.get('view') === 'evidence' ? 'evidence' : 'pathway'
    return { page: 'pathway', slug: decodeURIComponent(segments[1]), view }
  }

  return { page: 'home', view: 'pathway' }
}

function makePathwayUrl(slug, view = 'pathway') {
  const search = view === 'evidence' ? '?view=evidence' : ''
  return `/pathway/${encodeURIComponent(slug)}${search}`
}

async function discoverPathways() {
  const repository = await fetchJson(API_ROOT)
  const branch = repository.default_branch
  const tree = await fetchJson(`${API_ROOT}/git/trees/${branch}?recursive=1`)
  const bundleCandidates = await pickLatestBundles(
    tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
    branch,
  )

  const pathwayResults = await Promise.all(
    bundleCandidates.map(async ({ pathwaySlug, version, bundlePath }) => {
      try {
        const bundle = await fetchJson(rawUrl(branch, bundlePath))
        const reviewPackPath = `pathways/${pathwaySlug}/${version}/drafts/review-pack.md`
        let reviewPack = ''

        try {
          reviewPack = await fetchText(rawUrl(branch, reviewPackPath))
        } catch {
          reviewPack = ''
        }

        const summaryHtml = safeText(bundle?.page_contents_html)
        const sections = normalizeSections(bundle?.accordion_sections)

        return {
          id: pathwaySlug,
          slug: pathwaySlug,
          title: formatPathwayName(pathwaySlug),
          topic: typeof bundle?.topic === 'string' && bundle.topic.trim()
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

  return pathwayResults.filter(Boolean)
}

function navigate(url) {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

async function copyHtmlToClipboard(html) {
  await navigator.clipboard.writeText(html)
}

function SectionCard({ copied, onCopy, section, isOpen, onToggle }) {
  return (
    <article className={`section-card ${isOpen ? 'open' : ''}`}>
      <div className="section-header">
        <button className="section-toggle" onClick={onToggle} type="button">
          <span>{section.heading}</span>
          <span className="section-icon">{isOpen ? '−' : '+'}</span>
        </button>
        <button className={`copy-button ${copied ? 'copied' : ''}`} onClick={onCopy} type="button">
          {copied ? 'Copied' : 'Copy HTML'}
        </button>
      </div>
      {isOpen ? (
        <div
          className="rich-copy section-body"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(section.html),
          }}
        />
      ) : null}
    </article>
  )
}

function StaticSectionCard({ copied, heading, html, onCopy }) {
  return (
    <article className="section-card open">
      <div className="section-header">
        <div className="section-toggle section-toggle-static">
          <span>{heading}</span>
        </div>
        <button className={`copy-button ${copied ? 'copied' : ''}`} onClick={onCopy} type="button">
          {copied ? 'Copied' : 'Copy HTML'}
        </button>
      </div>
      <div
        className="rich-copy section-body"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(html),
        }}
      />
    </article>
  )
}

function HomePage({ pathways, onOpenPathway }) {
  const [query, setQuery] = useState('')

  const filteredPathways = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return pathways
    }

    return pathways.filter((pathway) =>
      [pathway.title, pathway.topic, pathway.summaryText].some((field) =>
        safeText(field).toLowerCase().includes(normalizedQuery),
      ),
    )
  }, [pathways, query])

  return (
    <>
      <header className="hero hero-home">
        <div className="hero-copy">
          <p className="eyebrow">DG RefHelp Pathways</p>
          <h1>Referral pathways for primary care.</h1>
          <p className="lede">
            Browse current referral pathways and open each topic for practical guidance and its
            supporting evidence summary.
          </p>
        </div>

        <div className="hero-panel">
          <p className="eyebrow">Source</p>
          <p className="source-summary">
            Live content pulled from{' '}
            <a href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`} target="_blank" rel="noreferrer">
              {REPO_OWNER}/{REPO_NAME}
            </a>
            .
          </p>
          <div className="stat-row">
            <div className="metric">
              <span className="metric-value">{String(pathways.length).padStart(2, '0')}</span>
              <span className="metric-label">Pathways</span>
            </div>
            <div className="metric">
              <span className="metric-value">2</span>
              <span className="metric-label">Views per pathway</span>
            </div>
          </div>
        </div>
      </header>

      <section className="directory-panel">
        <div className="directory-head">
          <div>
            <p className="eyebrow">Directory</p>
            <h2>Referral pathways</h2>
          </div>
          <label className="search-shell">
            <span className="search-label">Search pathways</span>
            <input
              className="search-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Frailty, hypertension, liver..."
              type="search"
              value={query}
            />
          </label>
        </div>

        <div className="directory-grid">
          {filteredPathways.map((pathway) => (
            <button
              className="directory-item"
              key={pathway.id}
              onClick={() => onOpenPathway(pathway.slug)}
              type="button"
            >
              <span className="directory-title">{pathway.title}</span>
              <span className="directory-arrow">Open</span>
            </button>
          ))}
        </div>

        {filteredPathways.length === 0 ? (
          <p className="empty-state">No pathways matched that search.</p>
        ) : null}
      </section>
    </>
  )
}

function DetailPage({
  activePathway,
  activeView,
  activeReviewHtml,
  copiedSection,
  onBack,
  onChangeView,
  onCopySection,
  openSections,
  onToggleSection,
}) {
  const sectionState = openSections[activePathway.id] || {}

  return (
    <>
      <header className="detail-hero">
        <button className="back-link" onClick={onBack} type="button">
          All pathways
        </button>

        <div className="detail-headline">
          <p className="eyebrow">Referral pathway</p>
          <h1>{activePathway.title}</h1>
        </div>

        <div className="detail-actions">
          <div className="view-switcher" role="tablist" aria-label="Pathway views">
            <button
              aria-selected={activeView === 'pathway'}
              className={`view-tab ${activeView === 'pathway' ? 'active' : ''}`}
              onClick={() => onChangeView('pathway')}
              role="tab"
              type="button"
            >
              Pathway
            </button>
            <button
              aria-selected={activeView === 'evidence'}
              className={`view-tab ${activeView === 'evidence' ? 'active' : ''}`}
              onClick={() => onChangeView('evidence')}
              role="tab"
              type="button"
            >
              Evidence
            </button>
          </div>

          <a
            className="source-link"
            href={rawUrl(activePathway.branch, activePathway.rawBundlePath)}
            target="_blank"
            rel="noreferrer"
          >
            View source bundle
          </a>
        </div>
      </header>

      {activeView === 'pathway' ? (
        <main className="detail-layout">
          <section className="sections-panel">
            <div className="section-stack">
              <StaticSectionCard
                copied={copiedSection === `${activePathway.id}:Background`}
                heading="Background"
                html={activePathway.summaryHtml}
                onCopy={() => onCopySection(`${activePathway.id}:Background`, activePathway.summaryHtml)}
              />
              {activePathway.sections.map((section) => (
                <SectionCard
                  copied={copiedSection === `${activePathway.id}:${section.heading}`}
                  key={section.heading}
                  onCopy={() => onCopySection(`${activePathway.id}:${section.heading}`, section.html)}
                  section={section}
                  isOpen={Boolean(sectionState[section.heading])}
                  onToggle={() => onToggleSection(section.heading)}
                />
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className="detail-layout evidence-layout">
          <section className="evidence-card">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Evidence summary</p>
              </div>
            </div>

            {activeReviewHtml ? (
              <div
                className="markdown-copy"
                dangerouslySetInnerHTML={{ __html: activeReviewHtml }}
              />
            ) : (
              <p className="empty-state">No review pack found for this pathway version.</p>
            )}
          </section>
        </main>
      )}
    </>
  )
}

function App() {
  const [pathways, setPathways] = useState([])
  const [route, setRoute] = useState(parseLocation)
  const [openSections, setOpenSections] = useState({})
  const [copiedSection, setCopiedSection] = useState('')
  const [status, setStatus] = useState({ type: 'loading', message: 'Loading pathways from GitHub…' })

  useEffect(() => {
    function handlePopState() {
      setRoute(parseLocation())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let cancelled = false

    discoverPathways()
      .then((items) => {
        if (cancelled) {
          return
        }

        setPathways(items)
        setStatus({ type: 'ready', message: '' })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setStatus({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown loading error',
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const activePathway = useMemo(() => {
    if (route.page !== 'pathway') {
      return null
    }

    return pathways.find((pathway) => pathway.slug === route.slug) ?? null
  }, [pathways, route])

  useEffect(() => {
    if (!activePathway) {
      return
    }

    setOpenSections((current) => {
      if (current[activePathway.id]) {
        return current
      }

      return {
        ...current,
        [activePathway.id]: activePathway.sections.reduce((accumulator, section, index) => {
          accumulator[section.heading] = index < 2
          return accumulator
        }, {}),
      }
    })
  }, [activePathway])

  useEffect(() => {
    if (route.page === 'pathway' && activePathway) {
      document.title = `${activePathway.title} | DG RefHelp Pathways`
      return
    }

    document.title = 'DG RefHelp Pathways'
  }, [activePathway, route.page])

  const activeReviewHtml = useMemo(() => {
    if (!activePathway?.reviewPack) {
      return ''
    }

    return DOMPurify.sanitize(marked.parse(activePathway.reviewPack))
  }, [activePathway])

  function openPathway(slug, view = 'pathway') {
    navigate(makePathwayUrl(slug, view))
  }

  function toggleSection(heading) {
    if (!activePathway) {
      return
    }

    setOpenSections((current) => ({
      ...current,
      [activePathway.id]: {
        ...current[activePathway.id],
        [heading]: !current[activePathway.id]?.[heading],
      },
    }))
  }

  async function handleCopySection(sectionKey, html) {
    try {
      await copyHtmlToClipboard(html)
      setCopiedSection(sectionKey)
      window.setTimeout(() => {
        setCopiedSection((current) => (current === sectionKey ? '' : current))
      }, 1400)
    } catch {
      setStatus({
        type: 'error',
        message: 'Unable to copy HTML to clipboard in this browser.',
      })
    }
  }

  return (
    <div className="shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <div className="page-frame">
        {status.type === 'loading' ? <div className="message-panel">{status.message}</div> : null}
        {status.type === 'error' ? (
          <div className="message-panel error">
            <p>Unable to load pathway content from GitHub.</p>
            <p>{status.message}</p>
          </div>
        ) : null}

        {status.type === 'ready' && route.page === 'home' ? (
          <HomePage pathways={pathways} onOpenPathway={openPathway} />
        ) : null}

        {status.type === 'ready' && route.page === 'pathway' && activePathway ? (
          <DetailPage
            activePathway={activePathway}
            activeReviewHtml={activeReviewHtml}
            activeView={route.view}
            copiedSection={copiedSection}
            onBack={() => navigate('/')}
            onChangeView={(view) => openPathway(activePathway.slug, view)}
            onCopySection={handleCopySection}
            onToggleSection={toggleSection}
            openSections={openSections}
          />
        ) : null}

        {status.type === 'ready' && route.page === 'pathway' && !activePathway ? (
          <section className="message-panel">
            <p>That pathway could not be found.</p>
            <button className="back-link" onClick={() => navigate('/')} type="button">
              Return to directory
            </button>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export default App
