// Fork: first, so a Review page's API calls go to its own path before any module calls them.
import './review-page-base';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@plannotator/editor';
import '@plannotator/editor/styles';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);