"""Replayable, context-gated Mainland terminology normalization after t2s.

Do not run unrestricted regional conversion: e.g. a mathematical array and
an antenna array have different Chinese names. Rules never edit user terms.
"""
import re


def normalize_region(script_label, source, definition, domain, policy):
    target = script_label
    applied = []
    context = source + ' ' + definition
    for rule in policy['rules']:
        if domain not in rule['domains'] or not re.search(rule['contextPattern'], context, re.I):
            continue
        if rule['from'] not in target:
            continue
        before = target
        target = target.replace(rule['from'], rule['to'])
        applied.append({'rule': rule['id'], 'before': before, 'after': target})
    return target, applied
