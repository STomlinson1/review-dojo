const { app } = require('electron')

app.on('will-finish-launching', () => app.setActivationPolicy('prohibited'))

app.on('browser-window-created', (_event, window) => {
  window.once('show', () => {
    app.setActivationPolicy('accessory')
    app.hide()
    setTimeout(() => {
      if (!window.isDestroyed()) window.showInactive()
    }, 300)
  })
})
