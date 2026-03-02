import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const REPO_OWNER = 'fergusdonachie'
const REPO_NAME = 'dgrefhelp-pathways'
const DATA_ENDPOINT = '/api/pathways'

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

function normalizeRunSlug(runSlug) {
  return safeText(runSlug).replace(/-(wide-search|staged)$/i, '')
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
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
    return {
      page: 'pathway',
      slug: decodeURIComponent(segments[1]),
      version: searchParams.get('version') || '',
      view,
    }
  }

  return { page: 'home', view: 'pathway' }
}

function makePathwayUrl(slug, version = '', view = 'pathway') {
  const searchParams = new URLSearchParams()

  if (version) {
    searchParams.set('version', version)
  }

  if (view === 'evidence') {
    searchParams.set('view', 'evidence')
  }

  const search = searchParams.toString()
  return `/pathway/${encodeURIComponent(slug)}${search ? `?${search}` : ''}`
}

async function discoverPathways() {
  const data = await fetchJson(DATA_ENDPOINT)
  return Array.isArray(data?.pathways) ? data.pathways : []
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
      [pathway.title, pathway.topic, pathway.summaryText, ...pathway.versions.map((version) => version.version)].some((field) =>
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
            <article className="directory-item" key={pathway.id}>
              <div className="directory-item-head">
                <span className="directory-title">{pathway.title}</span>
                <span className="directory-meta">
                  {pathway.versions.length} version{pathway.versions.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="version-list">
                {pathway.versions.map((version) => (
                  <button
                    className="version-chip"
                    key={version.id}
                    onClick={() => onOpenPathway(pathway.slug, version.version)}
                    type="button"
                  >
                    {version.version}
                  </button>
                ))}
              </div>
            </article>
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
  activeVersion,
  activeView,
  activeReviewHtml,
  copiedSection,
  onBack,
  onChangeView,
  onChangeVersion,
  onCopySection,
  openSections,
  onToggleSection,
}) {
  const sectionState = openSections[activeVersion.id] || {}

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
          <div className="detail-controls">
            <div className="version-switcher" aria-label="Pathway versions">
              {activePathway.versions.map((version) => (
                <button
                  className={`version-tab ${version.version === activeVersion.version ? 'active' : ''}`}
                  key={version.id}
                  onClick={() => onChangeVersion(version.version)}
                  type="button"
                >
                  {version.version}
                </button>
              ))}
            </div>
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
          </div>

          <a
            className="source-link"
            href={rawUrl(activeVersion.branch, activeVersion.rawBundlePath)}
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
                copied={copiedSection === `${activeVersion.id}:Background`}
                heading="Background"
                html={activeVersion.summaryHtml}
                onCopy={() => onCopySection(`${activeVersion.id}:Background`, activeVersion.summaryHtml)}
              />
              {activeVersion.sections.map((section) => (
                <SectionCard
                  copied={copiedSection === `${activeVersion.id}:${section.heading}`}
                  key={section.heading}
                  onCopy={() => onCopySection(`${activeVersion.id}:${section.heading}`, section.html)}
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

  const activeVersion = useMemo(() => {
    if (!activePathway) {
      return null
    }

    return (
      activePathway.versions.find((version) => version.version === route.version) ||
      activePathway.versions[0] ||
      null
    )
  }, [activePathway, route.version])

  useEffect(() => {
    if (!activeVersion) {
      return
    }

    setOpenSections((current) => {
      if (current[activeVersion.id]) {
        return current
      }

      return {
        ...current,
        [activeVersion.id]: activeVersion.sections.reduce((accumulator, section, index) => {
          accumulator[section.heading] = index < 2
          return accumulator
        }, {}),
      }
    })
  }, [activeVersion])

  useEffect(() => {
    if (route.page === 'pathway' && activePathway && activeVersion) {
      document.title = `${activePathway.title} ${activeVersion.version} | DG RefHelp Pathways`
      return
    }

    document.title = 'DG RefHelp Pathways'
  }, [activePathway, activeVersion, route.page])

  const activeReviewHtml = useMemo(() => {
    if (!activeVersion?.reviewPack) {
      return ''
    }

    return DOMPurify.sanitize(marked.parse(activeVersion.reviewPack))
  }, [activeVersion])

  function openPathway(slug, version = '', view = 'pathway') {
    navigate(makePathwayUrl(slug, version, view))
  }

  function toggleSection(heading) {
    if (!activeVersion) {
      return
    }

    setOpenSections((current) => ({
      ...current,
      [activeVersion.id]: {
        ...current[activeVersion.id],
        [heading]: !current[activeVersion.id]?.[heading],
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

        {status.type === 'ready' && route.page === 'pathway' && activePathway && activeVersion ? (
          <DetailPage
            activePathway={activePathway}
            activeVersion={activeVersion}
            activeReviewHtml={activeReviewHtml}
            activeView={route.view}
            copiedSection={copiedSection}
            onBack={() => navigate('/')}
            onChangeVersion={(version) => openPathway(activePathway.slug, version, route.view)}
            onChangeView={(view) => openPathway(activePathway.slug, activeVersion.version, view)}
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
