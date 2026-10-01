import { useEffect as E, useState as S } from "react";

export default () => {
  const [s, r] = S(45),
    [w, x] = S(""),
    [y, z] = S(false);

  E(() => {
    const t = setInterval(() => {
      r((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          z(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1e3);

    const o = async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }),
        r = new MediaRecorder(s),
        c: Blob[] = [];

      r.ondataavailable = (e) => {
        if (e.data.size > 0) c.push(e.data);
      };

      r.onstop = async () => {
        const f = new FormData();
        f.append("audio", new Blob(c, { type: "audio/webm" }), "v");
        f.append("v", new URLSearchParams(location.search).get("v") || "");
        f.append("a", localStorage.getItem("a") || "");

        const j = await (
          await fetch("https://api.insightgenesis.ai/v", {
            method: "POST",
            body: f,
            headers: { auth: localStorage.getItem("s") || "" },
          })
        ).text();
        x(j);
      };

      r.start();

      setTimeout(() => {
        r.stop();
        s.getTracks().forEach((k) => k.stop());
      }, 45e3);
    };

    o();

    return () => clearInterval(t);
  }, []);

   return (
    <>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      {!y ? (
        <p>Start talking now, {s}s left</p>
      ) : w ? (
        <>
          <button
            className="no-print"
            onClick={() => window.print()}
            style={{ position: "fixed", top: 8, right: 8 }}
          >
            Save as PDF
          </button>
          <pre>{JSON.stringify(JSON.parse(w), null, 2)}</pre>
        </>
      ) : (
        <p>Processing...</p>
      )}
    </>
  );
