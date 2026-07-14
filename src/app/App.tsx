import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { strings } from '../lib/strings'

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">{strings.appName}</h1>
      <p className="text-stone-600">{strings.appTagline}</p>
      <p className="text-sm text-stone-400">{strings.home.placeholder}</p>
    </main>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  )
}
