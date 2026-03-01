import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const REPO_OWNER = 'fergusdonachie'
const REPO_NAME = 'dgrefhelp-pathways'
const BRANCH = 'main'
const API_ROOT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}`

marked.setOptions({
  breaks: true,
  gfm: true,
})

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

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

async function discoverPathways() {
  const tree = await fetchJson(`${API_ROOT}/git/trees/${BRANCH}?recursive=1`)
  const bundleCandidates = pickLatestBundles(
    tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
  )

  const pathways = await Promise.all(
    bundleCandidates.map(async ({ pathwaySlug, version, bundlePath }) => {
      const bundle = await fetchJson(`${RAW_ROOT}/${bundlePath}`)
      const reviewPackPath = `pathways/${pathwaySlug}/${version}/drafts/review-pack.md`
      let reviewPack = ''

      try {
        reviewPack = await fetchText(`${RAW_ROOT}/${reviewPackPath}`)
      } catch {
        reviewPack = ''
      }

      const summaryText = stripHtml(bundle.page_contents_html)
      const referralSection = bundle.accordion_sections.find((section) =>
        /who to refer/i.test(section.heading),
      )

      return {
        id: pathwaySlug,
        slug: pathwaySlug,
        title: bundle.topic ? formatPathwayName(slugify(bundle.topic)) : formatPathwayName(pathwaySlug),
        topic: bundle.topic || formatPathwayName(pathwaySlug),
        version,
        summaryText,
        summaryHtml: bundle.page_contents_html,
        sections: bundle.accordion_sections,
        reviewPack,
        referralHighlights: referralSection ? stripHtml(referralSection.html) : '',
        rawBundlePath: bundlePath,
      }
    }),
  )

  return pathways
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
          className="rich-copy"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(section.html),
          }}
        />
      ) : null}
    </article>
  )
}

function App() {
  const [pathways, setPathways] = useState([])
  const [activeId, setActiveId] = useState('')
  const [openSections, setOpenSections] = useState({})
  const [status, setStatus] = useState({ type: 'loading', message: 'Loading pathways from GitHub…' })

  useEffect(() => {
    let cancelled = false

    discoverPathways()
      .then((items) => {
        if (cancelled) {
          return
        }

        setPathways(items)
        setActiveId(items[0]?.id ?? '')
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

  const activePathway = useMemo(
    () => pathways.find((pathway) => pathway.id === activeId) ?? pathways[0] ?? null,
    [activeId, pathways],
  )

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

  const activeReviewHtml = useMemo(() => {
    if (!activePathway?.reviewPack) {
      return ''
    }

    return DOMPurify.sanitize(marked.parse(activePathway.reviewPack))
  }, [activePathway])

  const stats = useMemo(() => {
    const sectionCount = pathways.reduce((total, pathway) => total + pathway.sections.length, 0)
    return [
      { label: 'Live pathways', value: String(pathways.length).padStart(2, '0') },
      { label: 'Structured sections', value: String(sectionCount).padStart(2, '0') },
      { label: 'Content source', value: 'GitHub' },
    ]
  }, [pathways])

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

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">DG RefHelp Pathways</p>
          <h1>Referral pathways with the evidence pack beside the decision.</h1>
          <p className="lede">
            A React frontend that discovers the latest pathway bundles from
            <a href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`} target="_blank" rel="noreferrer">
              {' '}
              {REPO_OWNER}/{REPO_NAME}
            </a>
            , then renders the pathway summary, referral logic, and clinician review pack in one place.
          </p>
        </div>

        <div className="stat-grid">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </header>

      {status.type === 'loading' ? <div className="message-panel">{status.message}</div> : null}
      {status.type === 'error' ? (
        <div className="message-panel error">
          <p>Unable to load pathway content from GitHub.</p>
          <p>{status.message}</p>
        </div>
      ) : null}

      {activePathway ? (
        <main className="layout">
          <aside className="pathway-rail">
            <div className="rail-header">
              <p className="eyebrow">Pathways</p>
              <h2>Latest published bundles</h2>
            </div>

            <div className="pathway-list">
              {pathways.map((pathway) => (
                <button
                  className={`pathway-card ${pathway.id === activePathway.id ? 'active' : ''}`}
                  key={pathway.id}
                  onClick={() => setActiveId(pathway.id)}
                  type="button"
                >
                  <span className="pathway-title">{formatPathwayName(pathway.slug)}</span>
                  <span className="pathway-meta">{pathway.version}</span>
                  <span className="pathway-summary">{pathway.summaryText}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="content-column">
            <section className="feature-card">
              <div className="feature-head">
                <div>
                  <p className="eyebrow">Current pathway</p>
                  <h2>{formatPathwayName(activePathway.slug)}</h2>
                </div>
                <a
                  className="source-link"
                  href={`${RAW_ROOT}/${activePathway.rawBundlePath}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source bundle
                </a>
              </div>

              <div
                className="rich-copy intro-copy"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(activePathway.summaryHtml),
                }}
              />

              {activePathway.referralHighlights ? (
                <div className="highlight-panel">
                  <p className="eyebrow">Referral focus</p>
                  <p>{activePathway.referralHighlights}</p>
                </div>
              ) : null}
            </section>

            <section className="sections-panel">
              <div className="panel-head">
                <p className="eyebrow">Pathway structure</p>
                <h3>Accordion sections</h3>
              </div>

              <div className="section-stack">
                {activePathway.sections.map((section) => (
                  <SectionCard
                    key={section.heading}
                    section={section}
                    isOpen={Boolean(openSections[activePathway.id]?.[section.heading])}
                    onToggle={() => toggleSection(section.heading)}
                  />
                ))}
              </div>
            </section>
          </section>

          <section className="evidence-column">
            <section className="evidence-card">
              <div className="panel-head">
                <p className="eyebrow">Evidence summary</p>
                <h3>Clinician review pack</h3>
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
          </section>
        </main>
      ) : null}
    </div>
  )
}

export default App
