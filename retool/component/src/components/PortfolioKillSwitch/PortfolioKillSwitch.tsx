import React, { useEffect, useRef, useState } from 'react'
import { type FC } from 'react'
import { Retool } from '@tryretool/custom-component-support'
import { SHELL_HTML } from './assets.generated'

// Renders the Portfolio Kill Switch dashboard inside its own nested iframe (srcDoc), reusing
// the exact same dashboard.css/dashboard.js/body.html already built and tested for the Claude
// Artifact and GitHub Pages deployments. A nested iframe — rather than injecting the CSS/JS
// directly into the surrounding Retool page — guarantees dashboard.css's global rules
// (`*`, `html,body`) can't leak out into the rest of your Retool app, regardless of whether
// this component itself already runs in an isolated context.
export const PortfolioKillSwitch: FC = () => {
  const [dataset] = Retool.useStateObject({
    name: 'dataset',
    label: 'Dataset',
    description: 'Bind to {{ buildDataset.data }} — the merged Adjust dataset dashboard.js expects.',
  })

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)

  useEffect(() => {
    if (!iframeLoaded || !dataset) return
    const win = iframeRef.current?.contentWindow as (Window & { __dashboardSetData?: (d: unknown) => void }) | undefined | null
    if (win?.__dashboardSetData) {
      win.__dashboardSetData(dataset)
    }
  }, [iframeLoaded, dataset])

  return (
    <iframe
      ref={iframeRef}
      title="Portfolio Kill Switch"
      srcDoc={SHELL_HTML}
      onLoad={() => setIframeLoaded(true)}
      style={{ width: '100%', height: '100%', minHeight: '900px', border: 'none' }}
    />
  )
}
