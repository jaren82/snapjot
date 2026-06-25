// SnapJot content script
// Select a region → annotate with box/text → copy to clipboard. Zero dependencies.
(() => {
  // Guard against double-injection (re-click) so listeners aren't duplicated
  if (window.__snapjotInit) return;
  window.__snapjotInit = true;

  const Z = 2147483640; // sit above page content
  const RED = "#ff3b30";
  const FONT = "-apple-system,system-ui,Segoe UI,Roboto,sans-serif";
  const t = (k) => chrome.i18n.getMessage(k) || k; // localized string
  let session = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SNAPJOT_START") start(msg.dataUrl);
  });

  function start(dataUrl) {
    if (session) cleanup();
    const img = new Image();
    img.onload = () => initSelection(img);
    img.onerror = () => console.warn("[SnapJot] image load failed");
    img.src = dataUrl;
  }

  // ---------- helpers ----------
  function el(tag, style, parent) {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (parent) parent.appendChild(e);
    return e;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  }

  function cleanup() {
    if (!session) return;
    document.removeEventListener("keydown", onKey, true);
    (session.detachers || []).forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    if (session.root && session.root.parentNode)
      session.root.parentNode.removeChild(session.root);
    session = null;
  }

  function toast(text) {
    const el2 = el(
      "div",
      {
        position: "fixed",
        left: "50%",
        bottom: "32px",
        transform: "translateX(-50%)",
        background: "rgba(20,20,20,0.92)",
        color: "#fff",
        font: "600 14px/1.4 " + FONT,
        padding: "10px 16px",
        borderRadius: "10px",
        zIndex: String(Z + 5),
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      },
      document.body
    );
    el2.textContent = text;
    setTimeout(() => el2.remove(), 2400);
  }

  // ---------- step 1: region selection ----------
  function initSelection(img) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scaleX = img.naturalWidth / vw; // ≈ devicePixelRatio
    const scaleY = img.naturalHeight / vh;

    const root = el("div", {
      position: "fixed",
      inset: "0",
      zIndex: String(Z),
      cursor: "crosshair",
      userSelect: "none",
    });
    document.documentElement.appendChild(root);
    session = { root, img, scaleX, scaleY, detachers: [] };
    document.addEventListener("keydown", onKey, true);

    // captured frame as a stable backdrop
    const backdrop = el(
      "img",
      {
        position: "absolute",
        left: "0",
        top: "0",
        width: vw + "px",
        height: vh + "px",
        display: "block",
      },
      root
    );
    backdrop.src = img.src;

    const dim = el(
      "div",
      { position: "absolute", inset: "0", background: "rgba(0,0,0,0.45)" },
      root
    );

    const sel = el(
      "div",
      {
        position: "absolute",
        border: "2px solid " + RED,
        boxShadow: "0 0 0 100000px rgba(0,0,0,0.45)",
        display: "none",
        pointerEvents: "none",
      },
      root
    );

    const hint = el(
      "div",
      {
        position: "absolute",
        left: "50%",
        top: "24px",
        transform: "translateX(-50%)",
        background: "rgba(20,20,20,0.9)",
        color: "#fff",
        font: "600 13px/1.4 " + FONT,
        padding: "8px 14px",
        borderRadius: "8px",
        pointerEvents: "none",
      },
      root
    );
    hint.textContent = t("hintSelect");

    const sizeLabel = el(
      "div",
      {
        position: "absolute",
        background: RED,
        color: "#fff",
        font: "600 12px/1 " + FONT,
        padding: "3px 6px",
        borderRadius: "4px",
        display: "none",
        pointerEvents: "none",
      },
      root
    );

    let startX = 0,
      startY = 0,
      dragging = false;

    const rectFrom = (e) => ({
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      w: Math.abs(e.clientX - startX),
      h: Math.abs(e.clientY - startY),
    });

    function onDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      dim.style.display = "none"; // sel's box-shadow handles the dimming
      sel.style.display = "block";
      sizeLabel.style.display = "block";
      hint.style.display = "none";
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const r = rectFrom(e);
      Object.assign(sel.style, {
        left: r.x + "px",
        top: r.y + "px",
        width: r.w + "px",
        height: r.h + "px",
      });
      sizeLabel.textContent = r.w + " × " + r.h;
      sizeLabel.style.left = r.x + "px";
      sizeLabel.style.top = Math.max(0, r.y - 22) + "px";
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      const r = rectFrom(e);
      if (r.w < 5 || r.h < 5) {
        cleanup();
        return;
      }
      root.removeEventListener("mousedown", onDown);
      sel.style.display = "none";
      sizeLabel.style.display = "none";
      enterAnnotate(r);
    }

    root.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    session.detachers.push(() => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    });
  }

  // ---------- step 2: annotate ----------
  function enterAnnotate(rect) {
    const { img, scaleX, scaleY, root } = session;
    root.style.cursor = "default";

    // crop at native resolution
    const cw = Math.round(rect.w * scaleX);
    const ch = Math.round(rect.h * scaleY);
    const crop = document.createElement("canvas");
    crop.width = cw;
    crop.height = ch;
    crop
      .getContext("2d")
      .drawImage(img, rect.x * scaleX, rect.y * scaleY, cw, ch, 0, 0, cw, ch);

    const canvas = el(
      "canvas",
      {
        position: "fixed",
        left: rect.x + "px",
        top: rect.y + "px",
        width: rect.w + "px",
        height: rect.h + "px",
        zIndex: String(Z + 1),
        boxShadow: "0 0 0 2px " + RED + ", 0 8px 30px rgba(0,0,0,0.4)",
        cursor: "crosshair",
      },
      root
    );
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");

    const annotations = [];
    let preview = null;
    let tool = "box";
    const scale = cw / rect.w; // display→native ≈ dpr
    const lineW = Math.max(2, Math.round(3 * scale));
    const fontPx = Math.round(20 * scale);

    function drawOne(a) {
      if (a.type === "box") {
        ctx.lineWidth = lineW;
        ctx.strokeStyle = RED;
        ctx.strokeRect(a.x, a.y, a.w, a.h);
      } else {
        ctx.font = "700 " + fontPx + "px " + FONT;
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(2, Math.round(fontPx / 6));
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.fillStyle = RED;
        ctx.strokeText(a.text, a.x, a.y);
        ctx.fillText(a.text, a.x, a.y);
      }
    }
    function redraw() {
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(crop, 0, 0);
      annotations.forEach(drawOne);
      if (preview) drawOne(preview);
    }
    redraw();

    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (cw / r.width),
        y: (e.clientY - r.top) * (ch / r.height),
      };
    };

    // box drawing
    let drawing = false,
      sx = 0,
      sy = 0;
    function cDown(e) {
      if (tool === "box") {
        drawing = true;
        const p = toCanvas(e);
        sx = p.x;
        sy = p.y;
        preview = { type: "box", x: sx, y: sy, w: 0, h: 0 };
        e.preventDefault();
      } else {
        addTextInput(e);
      }
    }
    function cMove(e) {
      if (!drawing) return;
      const p = toCanvas(e);
      preview = {
        type: "box",
        x: Math.min(sx, p.x),
        y: Math.min(sy, p.y),
        w: Math.abs(p.x - sx),
        h: Math.abs(p.y - sy),
      };
      redraw();
    }
    function cUp() {
      if (!drawing) return;
      drawing = false;
      if (preview && preview.w > 3 && preview.h > 3) annotations.push(preview);
      preview = null;
      redraw();
    }
    canvas.addEventListener("mousedown", cDown);
    document.addEventListener("mousemove", cMove, true);
    document.addEventListener("mouseup", cUp, true);
    session.detachers.push(() => {
      document.removeEventListener("mousemove", cMove, true);
      document.removeEventListener("mouseup", cUp, true);
    });

    // text input
    function addTextInput(e) {
      const p = toCanvas(e);
      const input = el(
        "input",
        {
          position: "fixed",
          left: e.clientX + "px",
          top: e.clientY + "px",
          font: "700 20px " + FONT,
          color: RED,
          background: "rgba(255,255,255,0.9)",
          border: "1px dashed " + RED,
          borderRadius: "4px",
          padding: "1px 4px",
          zIndex: String(Z + 3),
          outline: "none",
          minWidth: "40px",
        },
        root
      );
      input.placeholder = t("notePlaceholder");
      input.focus();
      const commit = () => {
        const text = input.value.trim();
        input.remove();
        if (text) {
          annotations.push({ type: "text", x: p.x, y: p.y, text });
          redraw();
        }
      };
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") input.remove();
      });
      input.addEventListener("blur", commit);
    }

    // toolbar
    const bar = el(
      "div",
      {
        position: "fixed",
        zIndex: String(Z + 2),
        display: "flex",
        gap: "4px",
        background: "rgba(28,28,30,0.96)",
        padding: "6px",
        borderRadius: "12px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        font: "600 13px " + FONT,
      },
      root
    );
    const barTop =
      rect.y + rect.h + 10 + 44 < window.innerHeight
        ? rect.y + rect.h + 10
        : Math.max(8, rect.y - 50);
    bar.style.left =
      Math.max(8, Math.min(rect.x, window.innerWidth - 400)) + "px";
    bar.style.top = barTop + "px";

    function mkBtn(label, on, primary) {
      const b = el(
        "button",
        {
          border: "none",
          borderRadius: "8px",
          padding: "7px 11px",
          cursor: "pointer",
          color: primary ? "#fff" : "#eee",
          background: primary ? RED : "rgba(255,255,255,0.12)",
          font: "inherit",
          whiteSpace: "nowrap",
        },
        bar
      );
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        on(b);
      });
      return b;
    }

    const boxBtn = mkBtn("⬚ " + t("toolBox"), () => setTool("box"));
    const textBtn = mkBtn("T " + t("toolText"), () => setTool("text"));
    mkBtn("↶ " + t("toolUndo"), () => {
      annotations.pop();
      redraw();
    });
    mkBtn("📋 " + t("toolCopy"), copy, true);
    mkBtn("⬇︎ " + t("toolSave"), savePng);
    mkBtn("✕", cleanup);

    function setTool(tl) {
      tool = tl;
      canvas.style.cursor = tl === "text" ? "text" : "crosshair";
      boxBtn.style.background = tl === "box" ? RED : "rgba(255,255,255,0.12)";
      textBtn.style.background = tl === "text" ? RED : "rgba(255,255,255,0.12)";
    }
    setTool("box");

    const toBlob = () =>
      new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    async function copy() {
      try {
        // build ClipboardItem synchronously to keep the user-gesture activation
        const item = new ClipboardItem({ "image/png": toBlob() });
        await navigator.clipboard.write([item]);
        toast(t("copied"));
        cleanup();
      } catch (err) {
        console.warn("[SnapJot] clipboard failed, saving PNG:", err);
        downloadBlob(await toBlob());
        toast(t("copyFellBack"));
        cleanup();
      }
    }
    async function savePng() {
      downloadBlob(await toBlob());
      toast(t("savedPng"));
      cleanup();
    }
    function downloadBlob(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "snapjot-" + Date.now() + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
})();
