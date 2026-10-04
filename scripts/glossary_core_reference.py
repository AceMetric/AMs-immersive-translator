"""Reuse a checked core label only for the same domain, source and entity.

Text similarity alone is insufficient. Context-dependent senses and competing
core labels are deliberately excluded. This never changes candidate quality.
"""
import re


def core_reference(source, domain, entity_url, core_terms):
    if not re.fullmatch(r'https://www\.wikidata\.org/wiki/Q[1-9][0-9]*', entity_url):
        return None
    matches = [c for c in core_terms if c.get('quality') == 'core'
               and c['domain'] == domain and c['source'].casefold() == source.casefold()
               and c.get('sourceUrl') == entity_url]
    if not matches or any(c.get('requiresContext') for c in matches) or len({c['target'] for c in matches}) != 1:
        return None
    c = sorted(matches, key=lambda t: t['id'])[0]
    return {'id': c['id'], 'sourceUrl': entity_url, 'target': c['target']}
