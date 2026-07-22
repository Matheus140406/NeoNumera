"""Automação do WhatsApp Web via Playwright (sem pyautogui)."""

import re
import time
import urllib.parse

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

WHATSAPP_URL = "https://web.whatsapp.com"

# Seletores da UI do WhatsApp Web. Podem quebrar quando o WhatsApp atualizar o front-end.
SEL_QR_CODE = "canvas[aria-label], div[data-ref]"
SEL_CHAT_LOADED = "div[contenteditable='true'][data-tab]"
SEL_MESSAGE_BOX = "footer div[contenteditable='true'][data-tab]"
SEL_INVALID_PHONE_POPUP = "div[data-animate-modal-popup='true']"
SEL_POPUP_OK_BUTTON = "div[data-animate-modal-popup='true'] button"


class WhatsAppClient:
    def __init__(self, session_dir="wa_session", headless=True):
        self.session_dir = session_dir
        self.headless = headless
        self._playwright = None
        self.browser_context = None
        self.page = None

    def start(self):
        self._playwright = sync_playwright().start()
        self.browser_context = self._playwright.chromium.launch_persistent_context(
            self.session_dir,
            headless=self.headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        self.page = self.browser_context.new_page()
        return self

    def close(self):
        if self.browser_context:
            self.browser_context.close()
        if self._playwright:
            self._playwright.stop()

    def login(self, timeout_seconds=180):
        """Abre o WhatsApp Web e aguarda o usuário escanear o QR Code (ou a sessão já estar logada)."""
        self.page.goto(WHATSAPP_URL)
        try:
            self.page.wait_for_selector(SEL_CHAT_LOADED, timeout=timeout_seconds * 1000)
            print("Login efetuado com sucesso. Sessão salva em", self.session_dir)
            return True
        except PlaywrightTimeoutError:
            print("Tempo esgotado esperando o login. Tente novamente.")
            return False

    def send_message(self, phone, message, wait_after_load=6):
        """Envia `message` para `phone` (formato 55DDNNNNNNNNN). Retorna (status, detalhe)."""
        encoded_message = urllib.parse.quote(message)
        url = f"{WHATSAPP_URL}/send?phone={phone}&text={encoded_message}"
        self.page.goto(url)

        try:
            self.page.wait_for_load_state("networkidle", timeout=30000)
        except PlaywrightTimeoutError:
            pass

        time.sleep(wait_after_load)

        popup = self.page.locator(SEL_INVALID_PHONE_POPUP)
        if popup.count() > 0 and popup.first.is_visible():
            texto_popup = popup.first.inner_text().lower()
            try:
                self.page.locator(SEL_POPUP_OK_BUTTON).first.click()
            except Exception:
                pass
            if "telefone" in texto_popup or "phone" in texto_popup:
                return "SEM_WHATSAPP", texto_popup.strip().replace("\n", " ")
            return "ERRO_ENVIO", texto_popup.strip().replace("\n", " ")

        try:
            self.page.wait_for_selector(SEL_MESSAGE_BOX, timeout=30000)
        except PlaywrightTimeoutError:
            return "ERRO_ENVIO", "Caixa de mensagem não carregou"

        try:
            message_box = self.page.locator(SEL_MESSAGE_BOX).last
            message_box.click()
            self.page.keyboard.press("Enter")
            time.sleep(2)
        except Exception as exc:
            return "ERRO_ENVIO", str(exc)

        return "ENVIADO", ""


def sanitize_phone(raw_phone):
    """Normaliza um número para o formato 55DDNNNNNNNNN. Retorna None se inválido."""
    if raw_phone is None:
        return None

    digits = re.sub(r"\D", "", str(raw_phone))
    if not digits:
        return None

    if digits.startswith("55") and len(digits) in (12, 13):
        ddi, resto = digits[:2], digits[2:]
    elif len(digits) in (10, 11):
        ddi, resto = "55", digits
    else:
        return None

    ddd, numero = resto[:2], resto[2:]

    if len(numero) == 8:
        numero = "9" + numero
    elif len(numero) != 9:
        return None

    if not numero.startswith("9"):
        return None

    final = ddi + ddd + numero
    if len(final) != 13:
        return None

    return final
