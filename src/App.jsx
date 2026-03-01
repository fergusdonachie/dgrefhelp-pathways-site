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

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickLatestBundles(paths) {
  const latestByPathway = new Map()

  for (const path of paths) {
    const match = path.match(/^pathways\/([^/]+)\/([^/]+)\/outputs\/cms-upload-bundle\.json$/)
    if (!match) {
      continue
    }

    const [, pathwaySlug, version] = match
    const current = latestByPathway.get(pathwaySlug)

    if (!current || version.localeCompare(current.version) > 0) {
      latestByPathway.set(pathwaySlug, { pathwaySlug, version, bundlePath: path })
    }
  }

  return [...latestByPathway.values()].sort((left, right) =>
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
  const bundleCandidates = pickLatestBundles(
    tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
  )

  const pathways = await Promise.all(
    bundleCandidates.map(async ({ pathwaySlug, version, bundlePath }) => {
      const bundle = await fetchJson(rawUrl(branch, bundlePath))
      const reviewPackPath = `pathways/${pathwaySlug}/${version}/drafts/review-pack.md`
      let reviewPack = ''

      try {
        reviewPack = await fetchText(rawUrl(branch, reviewPackPath))
      } catch {
        reviewPack = ''
      }

      const summaryText = stripHtml(bundle.page_contents_html)

      return {
        id: pathwaySlug,
        slug: pathwaySlug,
        title: formatPathwayName(pathwaySlug),
        topic: bundle.topic || formatPathwayName(pathwaySlug),
        version,
        summaryText,
        summaryHtml: bundle.page_contents_html,
        sections: bundle.accordion_sections,
        reviewPack,
        rawBundlePath: bundlePath,
        branch,
      }
    }),
  )

  return pathways
}

function navigate(url) {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function SectionCard({ section, isOpen, onToggle }) {
  return (
    <article className={`section-card ${isOpen ? 'open' : ''}`}>
      <button className="section-toggle" onClick={onToggle} type="button">
        <span>{section.heading}</span>
        <span className="section-icon">{isOpen ? '−' : '+'}</span>
      </button>
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

function StaticSectionCard({ heading, html }) {
  return (
    <article className="section-card open">
      <div className="section-toggle section-toggle-static">
        <span>{heading}</span>
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
        field.toLowerCase().includes(normalizedQuery),
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
  onBack,
  onChangeView,
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
              <StaticSectionCard heading="Background" html={activePathway.summaryHtml} />
              {activePathway.sections.map((section) => (
                <SectionCard
                  key={section.heading}
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
            onBack={() => navigate('/')}
            onChangeView={(view) => openPathway(activePathway.slug, view)}
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
