import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Cpu,
  ExternalLink,
  Eye,
  KeyRound,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { PROVIDERS, modelById, providerById, providerCaps, type AiProvider } from '../lib/ai/providers'
import { useAiStore } from '../lib/aiStore'
import { getBridge } from '../lib/ai/bridge'

function CapBadges({ provider }: { provider: AiProvider }) {
  const caps = providerCaps(provider)
  return (
    <span className="cap-row">
      {caps.includes('text') && (
        <span className="cap" title="Text generation">
          <MessageSquare size={9} /> text
        </span>
      )}
      {caps.includes('vision') && (
        <span className="cap" title="Understands photos">
          <Eye size={9} /> vision
        </span>
      )}
      {caps.includes('imageEdit') && (
        <span className="cap strong" title="Can edit pixels with a mask">
          <Wand2 size={9} /> image edit
        </span>
      )}
    </span>
  )
}

export function AiSettings() {
  const open = useAiStore((s) => s.open)
  const settings = useAiStore((s) => s.settings)
  const vault = useAiStore((s) => s.vault)
  const desktop = useAiStore((s) => s.desktop)
  const notice = useAiStore((s) => s.notice)
  const testing = useAiStore((s) => s.testing)
  const testResult = useAiStore((s) => s.testResult)
  const setOpen = useAiStore((s) => s.setOpen)
  const selectProvider = useAiStore((s) => s.selectProvider)
  const selectModel = useAiStore((s) => s.selectModel)
  const setBaseUrl = useAiStore((s) => s.setBaseUrl)
  const saveKey = useAiStore((s) => s.saveKey)
  const clearKey = useAiStore((s) => s.clearKey)
  const runTest = useAiStore((s) => s.runTest)
  const patch = useAiStore((s) => s.patch)
  const refreshVault = useAiStore((s) => s.refreshVault)

  const [keyDraft, setKeyDraft] = useState('')
  const [baseDraft, setBaseDraft] = useState('')
  const [customModel, setCustomModel] = useState('')

  const selected = settings.providerId ? providerById(settings.providerId) : undefined
  const [detailId, setDetailId] = useState<string>(settings.providerId ?? 'openai')
  const detail = providerById(detailId) ?? PROVIDERS[0]

  useEffect(() => {
    if (open) void refreshVault()
  }, [open, refreshVault])

  useEffect(() => {
    setKeyDraft('')
    setBaseDraft(detail.baseUrl)
    setCustomModel(detail.models.some((m) => m.id === settings.modelId) ? '' : settings.modelId)
  }, [detail.id, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings.providerId) setDetailId(settings.providerId)
  }, [settings.providerId])

  const hasKey = useMemo(() => {
    if (!selected) return false
    if (selected.keyless) return true
    return !!vault?.providers[selected.id]
  }, [selected, vault])

  if (!open) return null

  const showKey = !detail.keyless
  const keySaved = !!vault?.providers[detail.id]

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="ai-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI settings">
        <header className="ai-head">
          <div>
            <h2>AI providers</h2>
            <p>
              12 providers, one switch. Everything below is optional — the on-device engine sorts, culls and edits with
              no account at all.
            </p>
          </div>
          <button className="btn icon ghost" onClick={() => setOpen(false)} title="Close">
            <X size={16} />
          </button>
        </header>

        <div className="ai-body">
          <aside className="ai-list">
            <button
              className={`provider-row ${!settings.providerId ? 'active' : ''}`}
              onClick={() => selectProvider(null)}
            >
              <span className="p-dot local">
                <Cpu size={11} />
              </span>
              <span className="p-copy">
                <strong>On-device only</strong>
                <small>no keys, no network</small>
              </span>
            </button>

            {PROVIDERS.map((p) => {
              const saved = p.keyless || !!vault?.providers[p.id]
              return (
                <button
                  key={p.id}
                  className={`provider-row ${detailId === p.id ? 'active' : ''} ${settings.providerId === p.id ? 'selected' : ''}`}
                  onClick={() => {
                    setDetailId(p.id)
                    selectProvider(p.id)
                  }}
                >
                  <span className={`p-dot ${saved ? 'ok' : ''} ${p.local ? 'local' : ''}`}>
                    {p.local ? <Cpu size={11} /> : <KeyRound size={11} />}
                  </span>
                  <span className="p-copy">
                    <strong>{p.name}</strong>
                    <small>{p.local ? 'local · keyless' : saved ? 'key saved' : 'needs a key'}</small>
                  </span>
                  <CapBadges provider={p} />
                </button>
              )
            })}

            <div className="ai-global">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.allowImageUpload}
                  onChange={(e) => patch({ allowImageUpload: e.target.checked })}
                  disabled={!settings.providerId}
                />
                <span>
                  <b>Send photos to the provider</b>
                  <small>
                    Needed for real photo understanding and image edits. Off = captions use metadata only, and the
                    on-device engine does the editing.
                  </small>
                </span>
              </label>
              <label className="toggle-row">
                <span>
                  <b>Image size sent</b>
                  <small>Smaller is cheaper and faster.</small>
                </span>
                <select
                  className="mini-select"
                  value={settings.imageEdge}
                  onChange={(e) => patch({ imageEdge: Number(e.target.value) as 768 | 1024 | 1536 })}
                >
                  <option value={768}>768 px</option>
                  <option value={1024}>1024 px</option>
                  <option value={1536}>1536 px</option>
                </select>
              </label>
            </div>
          </aside>

          <section className="ai-detail">
            <div className="ai-detail-head">
              <div>
                <h3>{detail.name}</h3>
                <p>{detail.blurb}</p>
              </div>
              <CapBadges provider={detail} />
            </div>

            {detail.notes && <div className="ai-note">{detail.notes}</div>}

            <div className="field">
              <label>Model</label>
              <div className="model-row">
                <select
                  className="mini-select wide"
                  value={settings.providerId === detail.id ? settings.modelId || detail.defaultModel : detail.defaultModel}
                  onChange={(e) => {
                    if (settings.providerId !== detail.id) selectProvider(detail.id)
                    selectModel(e.target.value)
                  }}
                >
                  {detail.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.caps.join(' + ')}
                      {m.note ? ` · ${m.note}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="model-row">
                <input
                  className="text-input"
                  placeholder="or type a model id (e.g. a newer snapshot)"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                />
                <button
                  className="btn small"
                  disabled={!customModel.trim()}
                  onClick={() => {
                    if (settings.providerId !== detail.id) selectProvider(detail.id)
                    selectModel(customModel.trim())
                  }}
                >
                  Use id
                </button>
              </div>
              {modelById(detail, settings.modelId)?.note && (
                <p className="hint">{modelById(detail, settings.modelId)?.note}</p>
              )}
            </div>

            {showKey && (
              <div className="field">
                <label>
                  API key{' '}
                  {keySaved ? (
                    <span className="key-state saved">
                      <ShieldCheck size={11} /> saved
                    </span>
                  ) : (
                    <span className="key-state">not set</span>
                  )}
                </label>
                <div className="model-row">
                  <input
                    className="text-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={detail.keyHint ?? 'paste key'}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                  />
                  <button
                    className="btn small primary"
                    disabled={!keyDraft.trim()}
                    onClick={async () => {
                      await saveKey(detail.id, keyDraft.trim())
                      setKeyDraft('')
                    }}
                  >
                    Save
                  </button>
                  {keySaved && (
                    <button className="btn small ghost danger" onClick={() => clearKey(detail.id)} title="Remove key">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="hint">
                  {desktop
                    ? `Encrypted with your OS keychain (${vault?.encryption ?? 'checking…'}). Requests are proxied through the app, so the key never enters the photo UI.`
                    : 'Web build: the key stays in memory for this tab and is lost on reload. The desktop app stores it in the OS keychain.'}
                  {detail.keyUrl && (
                    <>
                      {' · '}
                      <a
                        href={detail.keyUrl}
                        onClick={(e) => {
                          const bridge = getBridge()
                          if (bridge) {
                            e.preventDefault()
                            void bridge.openExternal(detail.keyUrl!)
                          }
                        }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        get a key <ExternalLink size={10} />
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="field">
              <label>Base URL</label>
              <div className="model-row">
                <input
                  className="text-input"
                  value={baseDraft}
                  onChange={(e) => setBaseDraft(e.target.value)}
                  spellCheck={false}
                />
                <button className="btn small" onClick={() => setBaseUrl(detail.id, baseDraft.trim())}>
                  Save
                </button>
                <button className="btn small ghost" onClick={() => setBaseUrl(detail.id, '')} title="Reset to default">
                  Reset
                </button>
              </div>
              <p className="hint">
                {detail.id === 'azure-openai'
                  ? 'Use https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT — the model field is the deployment name.'
                  : detail.local
                    ? 'Point this at wherever your local server listens.'
                    : 'Only needed for proxies or self-hosted gateways. https only.'}
              </p>
            </div>

            <div className="capability-matrix">
              {(
                [
                  ['text', 'Captions, alt text, hashtags'],
                  ['vision', 'Understands the actual photos'],
                  ['imageEdit', 'Eraser: remove objects with a mask'],
                ] as const
              ).map(([cap, label]) => {
                const ok = providerCaps(detail).includes(cap)
                return (
                  <div key={cap} className={`matrix-row ${ok ? 'on' : 'off'}`}>
                    {ok ? <Check size={12} /> : <X size={12} />}
                    <span>{label}</span>
                  </div>
                )
              })}
            </div>

            <div className="ai-test">
              <button
                className="btn"
                onClick={() => runTest(detail.id)}
                disabled={testing === detail.id || (!detail.keyless && !keySaved)}
              >
                {testing === detail.id ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
                {testing === detail.id ? 'Testing…' : 'Test connection'}
              </button>
              {testResult?.providerId === detail.id && (
                <span className={`test-result ${testResult.ok ? 'good' : 'bad'}`}>{testResult.message}</span>
              )}
            </div>
          </section>
        </div>

        <footer className="ai-foot">
          <span className={hasKey ? 'status good' : 'status'}>
            {settings.providerId
              ? `Active: ${providerById(settings.providerId)?.name} · ${settings.modelId || providerById(settings.providerId)?.defaultModel}`
              : 'Active: on-device engine'}
          </span>
          {notice && (
            <span className={`notice ${notice.tone}`}>
              {notice.message}
              {notice.hint ? ` — ${notice.hint}` : ''}
            </span>
          )}
          <div className="spacer" />
          <button className="btn small ghost" onClick={() => setOpen(false)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
