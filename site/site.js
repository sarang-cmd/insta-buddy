// Small progressive enhancement for the product screen tabs.
// The first panel is visible without JavaScript; the rest are revealed on demand.

const tablist = document.querySelector('[data-tablist]')

if (tablist) {
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))

  const select = (tab) => {
    for (const item of tabs) {
      const selected = item === tab
      item.setAttribute('aria-selected', String(selected))
      item.tabIndex = selected ? 0 : -1
      const panel = document.getElementById(item.getAttribute('aria-controls'))
      if (panel) panel.hidden = !selected
    }
  }

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]')
    if (tab) select(tab)
  })

  tablist.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement)
    if (current < 0) return

    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return

    event.preventDefault()
    tabs[next].focus()
    select(tabs[next])
  })
}
