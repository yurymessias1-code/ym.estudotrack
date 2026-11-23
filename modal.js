/*
 * Janelas (diálogos) acessíveis: o foco fica preso dentro da janela, o resto da página fica inerte
 * (não recebe foco nem leitor de tela) e, ao fechar, o foco volta para onde estava.
 * Usado pela janela "O que você estudou?" e pela de mesclagem. Carregado antes dos demais módulos.
 */

const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MODAL_BACKGROUND = ".app-shell, .bottom-nav";
const modalStack = [];

function modalIsVisible(element) {
  return !element.closest(".hidden") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function modalFocusable(modal) {
  return [...modal.querySelectorAll(MODAL_FOCUSABLE)].filter(modalIsVisible);
}

/** Fundo inerte enquanto houver janela aberta. */
function modalSyncBackground() {
  const open = modalStack.length > 0;
  document.querySelectorAll(MODAL_BACKGROUND).forEach((element) => {
    if (open) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    }
  });
}

function modalOpen(modal, { returnFocus = document.activeElement, initialFocus = null } = {}) {
  if (!modal || modalStack.some((entry) => entry.modal === modal)) return;
  modalStack.push({ modal, returnFocus });
  modalSyncBackground();
  const target = initialFocus && modalIsVisible(initialFocus) ? initialFocus : modalFocusable(modal)[0] || modal;
  target.focus();
}

function modalClose(modal) {
  const index = modalStack.findIndex((entry) => entry.modal === modal);
  if (index < 0) return;
  const [entry] = modalStack.splice(index, 1);
  modalSyncBackground();
  if (modalStack.length) return; // ainda há outra janela por cima: ela cuida do foco
  const back = entry.returnFocus;
  if (back && back !== document.body && back.isConnected && modalIsVisible(back)) {
    back.focus();
    return;
  }
  const fallback = document.querySelector(".workspace");
  if (fallback) {
    if (!fallback.hasAttribute("tabindex")) fallback.setAttribute("tabindex", "-1");
    fallback.focus({ preventScroll: true });
  }
}

function modalIsOpen(modal) {
  return modalStack.some((entry) => entry.modal === modal);
}

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Tab" || !modalStack.length) return;
    const { modal } = modalStack[modalStack.length - 1];
    const items = modalFocusable(modal);
    if (!items.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  },
  true
);

// Se o foco escapar por outro caminho (clique, leitor de tela), volta para a janela.
document.addEventListener("focusin", (event) => {
  if (!modalStack.length) return;
  const { modal } = modalStack[modalStack.length - 1];
  if (modal.contains(event.target) || event.target.closest(".toast")) return;
  const items = modalFocusable(modal);
  (items[0] || modal).focus();
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { modalOpen, modalClose, modalIsOpen };
}
