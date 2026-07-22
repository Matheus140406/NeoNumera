"""Gera variações de texto (troca de sinônimos) para reduzir o padrão repetido
de mensagens em massa — sem depender de nenhuma API externa."""

import random
import re

SINONIMOS = {
    "olá": ["oi", "olá", "e aí"],
    "oi": ["olá", "oi", "e aí"],
    "obrigado": ["valeu", "obrigado", "muito obrigado"],
    "obrigada": ["valeu", "obrigada", "muito obrigada"],
    "por favor": ["por favor", "por gentileza", "se possível"],
    "atenciosamente": ["atenciosamente", "abraços", "um abraço"],
    "boa tarde": ["boa tarde", "boa tarde pra você", "olá, boa tarde"],
    "bom dia": ["bom dia", "bom dia pra você", "olá, bom dia"],
    "boa noite": ["boa noite", "boa noite pra você", "olá, boa noite"],
    "tudo bem": ["tudo bem", "tudo certo", "tudo joia", "como vai"],
    "importante": ["importante", "essencial", "fundamental"],
    "lembrete": ["lembrete", "aviso", "recado"],
    "urgente": ["urgente", "importante e urgente", "prioritário"],
    "confirme": ["confirme", "por favor confirme", "nos confirme"],
    "vencimento": ["vencimento", "data de vencimento", "prazo"],
    "pagamento": ["pagamento", "quitação", "pagamento pendente"],
    "clique": ["clique", "acesse", "toque"],
    "qualquer dúvida": ["qualquer dúvida", "qualquer dúvida que tiver", "se tiver alguma dúvida"],
    "estamos à disposição": ["estamos à disposição", "estamos por aqui", "conte com a gente"],
    "código de acesso": ["código de acesso", "código", "código pessoal"],
}

PLACEHOLDER_RE = re.compile(r"\{[^{}]+\}")


def _tokenizar_preservando_placeholders(texto):
    """Divide o texto em trechos comuns e placeholders (`{nome}` etc), que nunca são alterados."""
    partes = []
    ultimo = 0
    for m in PLACEHOLDER_RE.finditer(texto):
        partes.append(("texto", texto[ultimo:m.start()]))
        partes.append(("placeholder", m.group()))
        ultimo = m.end()
    partes.append(("texto", texto[ultimo:]))
    return partes


def _variar_trecho(trecho, rng):
    resultado = trecho
    for chave, alternativas in SINONIMOS.items():
        padrao = re.compile(re.escape(chave), re.IGNORECASE)

        def substituir(m):
            opcoes = [a for a in alternativas if a.lower() != m.group().lower()] or alternativas
            escolha = rng.choice(opcoes)
            if m.group()[:1].isupper():
                escolha = escolha[:1].upper() + escolha[1:]
            return escolha

        resultado = padrao.sub(substituir, resultado)
    return resultado


def gerar_variacoes(mensagem, quantidade=2, seed=None):
    """Gera `quantidade` variações de `mensagem`, preservando placeholders como {nome}.

    Retorna uma lista de strings; itens iguais à mensagem original indicam que não havia
    nenhuma palavra reconhecida no dicionário de sinônimos pra variar.
    """
    partes = _tokenizar_preservando_placeholders(mensagem)
    variantes = []
    base_seed = seed if seed is not None else random.randint(0, 1_000_000)

    for i in range(quantidade):
        candidato = mensagem
        for tentativa in range(6):
            rng = random.Random(base_seed + i * 97 + tentativa)
            texto_variado = "".join(
                _variar_trecho(p[1], rng) if p[0] == "texto" else p[1] for p in partes
            )
            if texto_variado != mensagem and texto_variado not in variantes:
                candidato = texto_variado
                break
        variantes.append(candidato)

    return variantes
