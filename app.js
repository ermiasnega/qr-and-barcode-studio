// QR & Barcode Studio — browser-only interactions and local history.
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE = { theme: 'qrstudio-theme', history: 'qrstudio-history' };
  const contentInput = $('#code-content');
  const preview = $('#code-preview');
  const generatedResult = $('#generated-result');
  const historyList = $('#history-list');
  const historyEmpty = $('.history-empty');
  const scanFeedback = $('#scan-feedback');
  const cameraStage = $('#camera-stage');
  const video = $('#camera-video');
  let selectedType = 'qr';
  let latestGenerated = null;
  let mediaStream = null;
  let barcodeDetector = null;
  let scanFrame = 0;
  let lastDetectionAt = 0;
  let scanBusy = false;

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE.history) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.content === 'string') : [];
    } catch (error) {
      return [];
    }
  }

  function writeHistory(items) {
    try {
      localStorage.setItem(STORAGE.history, JSON.stringify(items.slice(0, 50)));
      return true;
    } catch (error) {
      toast('Could not save to local storage. Check your browser storage settings.', 'error');
      return false;
    }
  }

  function escapeText(text) {
    return String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function toast(message, kind = '') {
    const region = $('#toast-region');
    const item = document.createElement('div');
    item.className = `toast ${kind}`;
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 3800);
  }

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem(STORAGE.theme, dark ? 'dark' : 'light'); } catch (error) { /* Theme still works for this visit. */ }
    $$('.theme-state').forEach(label => { label.textContent = dark ? 'Dark' : 'Light'; });
    $$('.theme-icon, .mobile-theme').forEach(icon => { icon.textContent = dark ? '☾' : '☼'; });
    $$('.theme-button, .mobile-theme').forEach(button => button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`));
    const metaTheme = $('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = dark ? '#151522' : '#f6f7fb';
  }

  function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  function addHistory({ content, type, action = 'generated', size = 256 }) {
    const items = readHistory();
    items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, content, type, action, size, createdAt: new Date().toISOString() });
    writeHistory(items);
    renderHistory();
  }

  function renderHistory() {
    const items = readHistory();
    $('.history-count').textContent = String(items.length);
    $('.nav-count').textContent = String(items.length);
    historyEmpty.hidden = items.length > 0;
    historyList.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('article');
      row.className = 'history-item';
      const icon = document.createElement('span');
      icon.className = `history-item-icon ${item.type === 'barcode' ? 'barcode-history-icon' : ''}`;
      icon.textContent = item.type === 'barcode' ? '▥' : item.action === 'scanned' ? '⌗' : '▦';
      icon.setAttribute('aria-hidden', 'true');
      const detail = document.createElement('div');
      detail.className = 'history-item-detail';
      const title = document.createElement('strong');
      title.textContent = item.action === 'scanned' ? `Scanned ${item.type === 'barcode' ? 'barcode' : 'QR code'}` : `Created ${item.type === 'barcode' ? 'barcode' : 'QR code'}`;
      const text = document.createElement('span');
      text.textContent = item.content;
      text.title = item.content;
      detail.append(title, text);
      const date = document.createElement('time');
      date.className = 'history-item-date';
      date.dateTime = item.createdAt || '';
      date.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const restore = document.createElement('button');
      restore.type = 'button'; restore.className = 'history-action'; restore.dataset.historyAction = 'restore';
      restore.dataset.id = item.id; restore.textContent = 'Use again'; restore.setAttribute('aria-label', `Use this ${item.type} content again`);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'history-remove'; remove.dataset.historyAction = 'remove'; remove.dataset.id = item.id;
      remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove this history item');
      row.append(icon, detail, date, restore, remove);
      historyList.append(row);
    });
  }

  function updateType(type) {
    selectedType = type;
    $$('.type-option').forEach(button => {
      const selected = button.dataset.type === type;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('.content-hint').textContent = type === 'barcode' ? 'Barcode uses CODE128; enter letters or numbers.' : 'Paste a link or type your own text.';
    contentInput.placeholder = type === 'barcode' ? 'Enter text or numbers for your barcode...' : 'Enter a URL, text, or anything you want to share...';
    $('.options-row .field-label').textContent = type === 'barcode' ? 'SIZE' : 'SIZE';
  }

  function generateCode(value = contentInput.value.trim(), type = selectedType, size = Number($('#code-size').value)) {
    if (!value) {
      contentInput.focus();
      toast('Enter some content before generating a code.', 'error');
      return false;
    }
    if (value.length > 500) {
      toast('Content must be 500 characters or fewer.', 'error');
      return false;
    }
    if (type === 'qr' && typeof window.QRCode !== 'function') {
      toast('QR generator did not load. Check your internet connection and refresh.', 'error');
      return false;
    }
    if (type === 'barcode' && typeof window.JsBarcode !== 'function') {
      toast('Barcode generator did not load. Check your internet connection and refresh.', 'error');
      return false;
    }
    preview.replaceChildren();
    try {
      if (type === 'qr') {
        const target = document.createElement('div');
        target.className = 'qr-target';
        preview.append(target);
        new QRCode(target, { text: value, width: size, height: size, colorDark: '#17172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        const canvas = $('canvas', target);
        if (canvas) { canvas.setAttribute('aria-label', 'Generated QR code'); }
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Generated CODE128 barcode');
        preview.append(svg);
        const scale = size === 128 ? 1 : size === 512 ? 3 : 2;
        JsBarcode(svg, value, { format: 'CODE128', lineColor: '#17172a', background: '#ffffff', width: scale, height: Math.round(size / 4), displayValue: true, font: 'DM Sans', fontSize: 14, margin: 12 });
      }
      latestGenerated = { content: value, type, size };
      generatedResult.hidden = false;
      addHistory({ ...latestGenerated, action: 'generated' });
      return true;
    } catch (error) {
      preview.replaceChildren();
      generatedResult.hidden = true;
      toast(type === 'barcode' ? 'Could not create that barcode. Try standard letters or numbers.' : 'That content is too long to fit in a QR code.', 'error');
      return false;
    }
  }

  function downloadGenerated() {
    if (!latestGenerated) return;
    let url;
    let filename = `qr-studio-${latestGenerated.type}`;
    if (latestGenerated.type === 'qr') {
      const canvas = $('canvas', preview);
      if (!canvas) { toast('The QR image is not ready yet.', 'error'); return; }
      url = canvas.toDataURL('image/png');
      filename += '.png';
    } else {
      const svg = $('svg', preview);
      if (!svg) return;
      const source = new XMLSerializer().serializeToString(svg);
      url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      filename += '.svg';
    }
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    if (latestGenerated.type === 'barcode') URL.revokeObjectURL(url);
  }

  async function copyContent() {
    if (!latestGenerated) return;
    try {
      await navigator.clipboard.writeText(latestGenerated.content);
    } catch (error) {
      const temporary = document.createElement('textarea');
      temporary.value = latestGenerated.content;
      temporary.style.position = 'fixed'; temporary.style.opacity = '0';
      document.body.append(temporary); temporary.select();
      const copied = document.execCommand('copy'); temporary.remove();
      if (!copied) { toast('Clipboard access is unavailable in this browser.', 'error'); return; }
    }
    toast('Content copied to clipboard.');
  }

  function setScanMessage(message, kind = '') {
    scanFeedback.textContent = message;
    scanFeedback.className = `scan-feedback${kind ? ` ${kind}` : ''}`;
  }

  function getDetector() {
    if (!('BarcodeDetector' in window)) return null;
    if (!barcodeDetector) {
      const supported = ['qr_code', 'aztec', 'code_128', 'code_39', 'code_93', 'codabar', 'data_matrix', 'ean_13', 'ean_8', 'itf', 'pdf417', 'upc_a', 'upc_e'];
      barcodeDetector = new BarcodeDetector({ formats: supported });
    }
    return barcodeDetector;
  }

  function showScanResult(result) {
    const value = result.rawValue || '';
    if (!value) return;
    stopCamera();
    setScanMessage(`Found ${result.format ? result.format.replaceAll('_', ' ').toUpperCase() : 'code'}: ${value}`, 'success');
    addHistory({ content: value, type: result.format === 'qr_code' ? 'qr' : 'barcode', action: 'scanned' });
    toast('Code scanned and added to your history.');
  }

  function stopCamera() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    cameraStage.classList.remove('is-scanning');
    const button = $('#camera-toggle');
    button.innerHTML = '<span class="camera-button-icon" aria-hidden="true">◉</span> Start camera';
  }

  async function scanVideoFrame() {
    if (!mediaStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (mediaStream) scanFrame = requestAnimationFrame(scanVideoFrame);
      return;
    }
    const now = performance.now();
    if (!scanBusy && now - lastDetectionAt > 250) {
      scanBusy = true; lastDetectionAt = now;
      try {
        const results = await barcodeDetector.detect(video);
        if (results.length) { showScanResult(results[0]); scanBusy = false; return; }
      } catch (error) { setScanMessage('Unable to read this frame. Try holding the code steady and in focus.', 'error'); }
      scanBusy = false;
    }
    if (mediaStream) scanFrame = requestAnimationFrame(scanVideoFrame);
  }

  async function startCamera() {
    if (mediaStream) { stopCamera(); setScanMessage('Camera stopped.'); return; }
    let detector;
    try { detector = getDetector(); }
    catch (error) { setScanMessage('Code scanning is not supported by this browser. Try a recent version of Chrome or Edge.', 'error'); return; }
    if (!detector) { setScanMessage('Camera scanning requires a browser with Barcode Detection support (for example, recent Chrome or Edge).', 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setScanMessage('Camera access is unavailable. Use HTTPS or localhost, or upload an image instead.', 'error'); return; }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = mediaStream;
      video.hidden = false;
      await video.play();
      cameraStage.classList.add('is-scanning');
      $('#camera-toggle').innerHTML = '<span class="camera-button-icon" aria-hidden="true">■</span> Stop camera';
      setScanMessage('Point your camera at a QR code or barcode.');
      scanFrame = requestAnimationFrame(scanVideoFrame);
    } catch (error) {
      stopCamera();
      setScanMessage(error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access or upload an image.' : 'Could not start the camera. Check that it is connected and not in use.', 'error');
    }
  }

  async function scanImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setScanMessage('Please choose an image file.', 'error'); return; }
    let detector;
    try { detector = getDetector(); }
    catch (error) { detector = null; }
    if (!detector) { setScanMessage('Image scanning is not supported by this browser. Try a recent version of Chrome or Edge.', 'error'); return; }
    setScanMessage(`Scanning ${file.name}…`);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const results = await detector.detect(bitmap);
        if (results.length) showScanResult(results[0]);
        else setScanMessage('No QR code or barcode found in this image. Try a clearer, well-lit image.', 'error');
      } finally { bitmap.close(); }
    } catch (error) {
      setScanMessage('Could not scan this image. Try a PNG, JPEG, or WebP image.', 'error');
    }
  }

  $$('.theme-button, .mobile-theme').forEach(button => button.addEventListener('click', toggleTheme));
  $$('.type-option').forEach(button => button.addEventListener('click', () => updateType(button.dataset.type)));
  contentInput.addEventListener('input', () => { $('.char-count').textContent = `${contentInput.value.length} / 500`; });
  $('#generate-code').addEventListener('click', () => generateCode());
  contentInput.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generateCode(); });
  $('#download-code').addEventListener('click', downloadGenerated);
  $('#copy-code').addEventListener('click', copyContent);
  $('.result-close').addEventListener('click', () => { generatedResult.hidden = true; });
  $('#clear-history').addEventListener('click', () => {
    if (!readHistory().length) { toast('Your history is already empty.'); return; }
    if (!window.confirm('Clear all saved QR and barcode history from this device?')) return;
    writeHistory([]); renderHistory(); toast('History cleared from this device.');
  });
  historyList.addEventListener('click', event => {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const items = readHistory();
    const item = items.find(entry => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.historyAction === 'remove') {
      writeHistory(items.filter(entry => entry.id !== item.id)); renderHistory();
    } else {
      contentInput.value = item.content;
      $('.char-count').textContent = `${item.content.length} / 500`;
      $('#code-size').value = String(item.size || 256);
      updateType(item.type === 'barcode' ? 'barcode' : 'qr');
      document.querySelector('.create-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      generateCode(item.content, item.type === 'barcode' ? 'barcode' : 'qr', Number(item.size || 256));
    }
  });

  $$('.scan-tab').forEach(tab => tab.addEventListener('click', () => {
    const uploadMode = tab.dataset.source === 'upload';
    $$('.scan-tab').forEach(other => {
      const active = other === tab;
      other.classList.toggle('active', active);
      other.setAttribute('aria-selected', String(active));
    });
    if (uploadMode) { stopCamera(); $('#upload').click(); }
    else setScanMessage('Camera mode selected. Start the camera when you are ready.');
  }));
  $('#camera-toggle').addEventListener('click', startCamera);
  $('#choose-image').addEventListener('click', event => { event.preventDefault(); $('#upload').click(); });
  $('#upload').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) scanImage(file);
    event.target.value = '';
  });
  $$('.nav-item').forEach(link => link.addEventListener('click', () => {
    $$('.nav-item').forEach(item => item.classList.toggle('active', item === link));
  }));
  window.addEventListener('pagehide', stopCamera);

  try { setTheme(localStorage.getItem(STORAGE.theme) || 'light'); }
  catch (error) { setTheme('light'); }
  renderHistory();
})();
