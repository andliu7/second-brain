// navigator.clipboard is a secure-context API: HTTPS, or localhost. Opened over plain http
// from a phone on the tailnet, it is undefined and every Copy button fails silently, which
// reads as a broken button rather than as a browser rule.
//
// The fallback is the pre-clipboard-API way: a hidden textarea, select it, document.execCommand.
// It is deprecated and it still works in every browser that withholds the modern one, which is
// exactly the case this exists for. Returns whether the text actually reached the clipboard, so
// the caller can say so rather than claiming success it cannot verify.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through: permission denied, or an insecure context that still exposes the object */ }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    // Off-screen rather than hidden: a display:none element cannot be selected.
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  } catch { return false; }
}
