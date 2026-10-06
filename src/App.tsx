import { useState } from 'react';

export default function App() {
  const [url, setUrl] = useState('https://example.com');

  return (
    <main className="wrap">
      <h1>HTTP Inspector</h1>
      <p className="sub">Enter a URL to inspect it.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          inputMode="url"
          aria-label="URL to inspect"
        />
        <button type="submit">Inspect</button>
      </form>
      <p className="hint">API wiring comes in the next step.</p>
    </main>
  );
}
