/* Barcode-/QR-Scanner über die Kamera.
 * Nutzt die native BarcodeDetector-API (Chrome/Android, Safari ab iOS 17 teilweise),
 * sonst ZXing (vendor/zxing.min.js). Kamera braucht HTTPS oder localhost.
 */
(function () {
  const NATIVE_FORMATS = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code", "data_matrix", "pdf417", "aztec"];
  let stream = null, raf = null, zxing = null, onHit = null, devices = [], devIdx = 0, track = null, torchOn = false;

  const Scanner = {
    available() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },

    async start(video, cb) {
      onHit = cb;
      await this.stop();
      const constraints = devices.length && devices[devIdx]
        ? { video: { deviceId: { exact: devices[devIdx].deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
        : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, ...constraints });
      video.srcObject = stream;
      await video.play().catch(() => {});
      track = stream.getVideoTracks()[0];
      try { track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}); } catch {}
      if (!devices.length) {
        try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); } catch {}
        const cur = track.getSettings().deviceId;
        devIdx = Math.max(0, devices.findIndex((d) => d.deviceId === cur));
      }

      let detector = null;
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const fm = NATIVE_FORMATS.filter((f) => supported.includes(f));
          if (fm.length) detector = new window.BarcodeDetector({ formats: fm });
        } catch {}
      }
      if (detector) {
        let busy = false;
        const loop = async () => {
          if (!stream) return;
          if (!busy && video.readyState >= 2) {
            busy = true;
            try {
              const codes = await detector.detect(video);
              if (codes.length) {
                // bei mehreren Codes den größten nehmen (meist der anvisierte)
                codes.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height);
                onHit && onHit(codes[0].rawValue, codes[0].format);
              }
            } catch {}
            busy = false;
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } else if (window.ZXing) {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        zxing = new ZXing.MultiFormatReader();
        zxing.setHints(hints);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          if (!stream) return;
          if (video.readyState >= 2 && video.videoWidth) {
            // nur den markierten Bereich auswerten → schneller und weniger Fehltreffer
            const vw = video.videoWidth, vh = video.videoHeight;
            const cw = Math.round(vw * 0.8), ch = Math.round(vh * 0.5);
            canvas.width = cw; canvas.height = ch;
            ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
            try {
              const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
              const res = zxing.decodeWithState(bmp);
              if (res) onHit && onHit(res.getText(), String(res.getBarcodeFormat()));
            } catch {}
          }
          raf = setTimeout(tick, 200);
        };
        tick();
      } else {
        throw new Error("Kein Barcode-Decoder verfügbar");
      }
      return { torch: !!(track.getCapabilities && track.getCapabilities().torch), multi: devices.length > 1 };
    },

    async toggleTorch() {
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch {}
    },
    async switchCamera(video) {
      if (devices.length < 2) return;
      devIdx = (devIdx + 1) % devices.length;
      return this.start(video, onHit);
    },
    async stop() {
      cancelAnimationFrame(raf); clearTimeout(raf); raf = null;
      zxing = null;
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      track = null; torchOn = false;
    },
  };
  window.Scanner = Scanner;
})();
