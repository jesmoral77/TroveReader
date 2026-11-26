import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { fontFaceCss } from './reader/fonts'
import './styles/app.css'
import './styles/reader.css'

// reading fonts for documents rendered directly in the page (Markdown, text, HTML)
const style = document.createElement('style')
style.textContent = fontFaceCss()
document.head.append(style)

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
