#!/usr/bin/env python3
"""Protocol invariants for the chaired, multimodel city committee."""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, resumen  # noqa: E402

CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')


def ejecuta(env, actor, verb, thread='', payload=None):
    args = ['node', CLIENT, 'committee', verb]
    if thread:
        args.append(thread)
    entrada = None
    if payload is not None:
        args += ['--input', '-']
        entrada = json.dumps(payload)
    entorno = dict(env, CITY_BUS_ACTOR=actor)
    return subprocess.run(args, input=entrada, capture_output=True, text=True,
                          env=entorno, timeout=12)


def valor(resultado):
    try:
        return json.loads(resultado.stdout)
    except json.JSONDecodeError:
        return {}


def para_hub(app):
    raiz = os.path.join(app, '.runtime', 'bus')
    for carpeta, _, nombres in os.walk(raiz):
        if 'endpoint.json' not in nombres:
            continue
        try:
            endpoint = json.load(open(os.path.join(carpeta, 'endpoint.json'),
                                      encoding='utf-8'))
            os.kill(int(endpoint['pid']), signal.SIGTERM)
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            pass
    time.sleep(.15)


def main():
    print('\n  chaired committee protocol')
    base = tempfile.mkdtemp(prefix='agents-city-committee-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    os.makedirs(city)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_committee\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        '---\nuser: alice\nagent: alice/ceo\n'
        'repos: [api, web, ops, ai]\n'
        'role.api: data-engineer\nrole.web: seo\n'
        'role.ops: quality\nrole.ai: blank\n'
        'runs.api: claude\nruns.web: codex\n'
        'runs.ops: opencode\nruns.ai: kimi\n---\n')
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='alice')
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)

    try:
        brief = {
            'question': 'Do we ship the migration?',
            'desiredOutcome': 'A verified go or no-go',
            'context': 'Release candidate 7',
            'definitionOfDone': ['tests reproduced', 'rollback named'],
            'participants': ['api', 'web'],
            'authority': 'decide',
            'maxRebuttals': 2,
        }
        forbidden = ejecuta(env, 'api', 'open', payload=brief)
        afirma('· only the seat can open a committee',
               forbidden.returncode != 0 and 'only the city chair' in forbidden.stderr,
               forbidden.stderr.strip())

        opened = ejecuta(env, 'seat', 'open', payload=brief)
        state = valor(opened)
        afirma('· a complete chair brief opens',
               opened.returncode == 0 and state.get('progress', {}).get('status') == 'collecting',
               opened.stderr.strip())
        thread = state.get('id', '')
        afirma('· it selects only relevant repo agents',
               state.get('brief', {}).get('participants') == ['api', 'web'], str(state))
        comprueba(
            '· the act records each participant specialty separately from authority',
            state.get('participantRoles'),
            {'api': 'data-engineer', 'web': 'seo'},
        )

        api_position = {
            'stance': 'conditional',
            'recommendation': 'ship only after replaying the migration',
            'evidence': ['api:test_migration passed at commit abc'],
            'expectedImpact': 'zero failed upgrades',
            'visibleWhen': 'staging replay completes',
            'withdrawIf': 'the replay fails',
        }
        first = ejecuta(env, 'api', 'respond', thread, api_position)
        afirma('· a selected specialist submits one isolated position',
               first.returncode == 0, first.stderr.strip())
        early_chair = valor(ejecuta(env, 'seat', 'show', thread))
        comprueba('· early content is hidden even from the chair',
                  early_chair.get('positions', {}).get('api'), 'received-hidden')
        afirma('· the chair view does not leak the recommendation',
               api_position['recommendation'] not in json.dumps(early_chair))
        early_peer = valor(ejecuta(env, 'web', 'show', thread))
        afirma('· another member sees neither its peer position nor a positions map',
               early_peer.get('myPosition') is None
               and 'positions' not in early_peer
               and api_position['recommendation'] not in json.dumps(early_peer))

        duplicate = ejecuta(env, 'api', 'respond', thread, api_position)
        afirma('· the same agent cannot anchor with repeated positions',
               duplicate.returncode != 0 and 'already submitted' in duplicate.stderr)
        web_position = {
            'stance': 'support',
            'recommendation': 'ship with the tested rollback banner',
            'evidence': ['web:e2e upgrade and rollback passed'],
        }
        second = ejecuta(env, 'web', 'respond', thread, web_position)
        afirma('· the barrier opens only after every selected position arrives',
               valor(second).get('progress', {}).get('status') == 'review')
        revealed = valor(ejecuta(env, 'seat', 'show', thread))
        afirma('· then the chair receives all positions together',
               revealed.get('positions', {}).get('api', {}).get('recommendation')
               == api_position['recommendation']
               and revealed.get('positions', {}).get('web', {}).get('recommendation')
               == web_position['recommendation'])

        premature = ejecuta(env, 'seat', 'decide', thread, {
            'outcome': 'ship', 'rationale': 'both support it', 'owner': 'alice',
            'executor': 'seat', 'verifier': 'ops',
            'verificationQuestion': 'does replay pass?',
            'selectedEvidence': ['two test runs'], 'reopenIf': ['replay fails'],
        })
        afirma('· the CEO cannot skip synthesis and jump to a decision',
               premature.returncode != 0 and 'publish a synthesis' in premature.stderr)
        synthesis = ejecuta(env, 'seat', 'synthesize', thread, {
            'summary': 'Both paths support a conditional release',
            'agreements': ['replay first'], 'conflicts': ['banner timing'],
            'unknowns': ['production lock duration'],
        })
        afirma('· the chair publishes one integration, not a vote',
               valor(synthesis).get('progress', {}).get('status') == 'deliberating')

        bad_basis = ejecuta(env, 'api', 'floor-request', thread, {
            'basis': 'opinion', 'reason': 'I disagree', 'evidence': ['none'],
        })
        afirma('· opinion alone cannot take the floor',
               bad_basis.returncode != 0 and 'basis must be one of' in bad_basis.stderr)
        requested = valor(ejecuta(env, 'api', 'floor-request', thread, {
            'basis': 'new_evidence', 'reason': 'staging replay just completed',
            'evidence': ['run 482 passed'],
        }))
        req_id = requested.get('myFloorRequests', [{}])[-1].get('id', '')
        afirma('· a member requests, rather than takes, the floor', bool(req_id))
        self_grant = ejecuta(env, 'web', 'floor-grant', thread, {'requestId': req_id})
        afirma('· a repo agent cannot grant another repo agent a turn',
               self_grant.returncode != 0 and 'only the city chair' in self_grant.stderr)
        granted = ejecuta(env, 'seat', 'floor-grant', thread, {'requestId': req_id})
        afirma('· the chair grants exactly one active reply', granted.returncode == 0)
        wrong_reply = ejecuta(env, 'web', 'reply', thread, {
            'claim': 'my reply', 'evidence': ['web log'], 'consequence': 'none',
        })
        afirma('· an ungranted agent cannot interrupt',
               wrong_reply.returncode != 0 and 'has not granted' in wrong_reply.stderr)
        reply = ejecuta(env, 'api', 'reply', thread, {
            'claim': 'the migration replay now passes',
            'evidence': ['run 482 immutable log'], 'consequence': 'release gate is satisfied',
        })
        web_outbox = os.path.join(
            app, '.runtime', 'bus', 'city-committee', 'outbox', 'web')
        web_deliveries = []
        for name in os.listdir(web_outbox):
            if name.endswith('.json'):
                web_deliveries.append(json.load(open(
                    os.path.join(web_outbox, name), encoding='utf-8')))
        heard = next((item for item in web_deliveries
                      if item.get('kind') == 'committee.reply.heard'), {})
        afirma('· granted evidence reaches the chair and is heard by every peer',
               reply.returncode == 0
               and heard.get('payload', {}).get('reply', {}).get('claim')
               == 'the migration replay now passes', json.dumps(heard))
        repeated_reply = ejecuta(env, 'api', 'reply', thread, {
            'claim': 'again', 'evidence': ['same'], 'consequence': 'noise',
        })
        afirma('· one grant cannot become an open debate',
               repeated_reply.returncode != 0 and 'has not granted' in repeated_reply.stderr)

        pending = valor(ejecuta(env, 'web', 'floor-request', thread, {
            'basis': 'risk', 'reason': 'rollback banner may cache',
            'evidence': ['cdn cache policy'],
        }))
        pending_id = pending.get('myFloorRequests', [{}])[-1].get('id', '')
        blocked = ejecuta(env, 'seat', 'decide', thread, {
            'outcome': 'ship', 'rationale': 'gates pass', 'owner': 'alice',
            'executor': 'seat', 'verifier': 'ops',
            'verificationQuestion': 'does replay pass?',
            'selectedEvidence': ['run 482'], 'reopenIf': ['replay fails'],
        })
        afirma('· a decision cannot strand a pending request',
               blocked.returncode != 0 and 'pending floor request' in blocked.stderr)
        denied = ejecuta(env, 'seat', 'floor-deny', thread, {
            'requestId': pending_id, 'reason': 'covered by the rollback check',
        })
        afirma('· the chair resolves the request explicitly', denied.returncode == 0)

        # ── the record, which had nobody checking it ────────────────────────
        #
        # Execution gets an independent verifier. The SUMMARY got nobody: a
        # position quietly softened, a condition dropped, a stance reported as
        # something it was not, and the member it belonged to had no valid basis
        # to say so. Not new evidence, not a contradiction in the facts — a
        # challenge to the chair's account of what they said.
        mal_citado = valor(ejecuta(env, 'web', 'floor-request', thread, {
            'basis': 'misrepresented',
            'reason': 'the synthesis reports me as unconditional; my stance was conditional',
            'evidence': [],
        }))
        mal_id = mal_citado.get('myFloorRequests', [{}])[-1].get('id', '')
        afirma('· a member can say the synthesis is not what it said', bool(mal_id))
        peticion = next((r for r in mal_citado.get('myFloorRequests', [])
                         if r.get('id') == mal_id), {})
        afirma(
            "· and its own position travels with it, so the chair is shown what it summarised",
            peticion.get('position', {}).get('recommendation')
            == web_position['recommendation'],
            json.dumps(peticion)[:300],
        )
        bloquea = ejecuta(env, 'seat', 'decide', thread, {
            'outcome': 'ship', 'rationale': 'gates pass', 'owner': 'alice',
            'executor': 'seat', 'verifier': 'ops',
            'verificationQuestion': 'does replay pass?',
            'selectedEvidence': ['run 482'], 'reopenIf': ['replay fails'],
        })
        afirma('· non-happy: and the chair cannot decide over an unanswered one',
               bloquea.returncode != 0 and 'pending floor request' in bloquea.stderr)
        ejecuta(env, 'seat', 'floor-deny', thread, {
            'requestId': mal_id, 'reason': 'the stance is quoted verbatim in the act',
        })
        # Resolved, so the pending guard is out of the way and what refuses the
        # second one is the rule this basis carries: once.
        otra_vez = ejecuta(env, 'web', 'floor-request', thread, {
            'basis': 'misrepresented', 'reason': 'still not right', 'evidence': [],
        })
        afirma('· non-happy: a correction that repeats is a filibuster with better manners',
               otra_vez.returncode != 0
               and 'already challenged how its position' in otra_vez.stderr,
               otra_vez.stderr.strip())

        # The one case where a member has nothing on the record: the chair
        # synthesised without it, said why, and now it turns up. There is no
        # summary of its position to be wrong, because it never gave one — and a
        # basis that would let it claim otherwise would let anybody claim
        # anything.
        segundo = valor(ejecuta(env, 'seat', 'open', payload={
            'question': 'Do we cache the banner?',
            'desiredOutcome': 'A yes or no',
            'definitionOfDone': ['a decision'],
            'participants': ['api', 'ops'],
            'authority': 'recommend',
        }))
        hilo2 = segundo.get('id', '')
        ejecuta(env, 'api', 'respond', hilo2, {
            'stance': 'support', 'recommendation': 'cache it',
            'evidence': ['cdn hit rate'], 'expectedImpact': 'fewer origin hits',
            'visibleWhen': 'next deploy', 'withdrawIf': 'the banner changes hourly',
        })
        sin_esperar = ejecuta(env, 'seat', 'synthesize', hilo2, {
            'summary': 'api says cache', 'agreements': ['cache it'],
            'conflicts': [], 'unknowns': [],
            'proceedWithout': 'ops has not answered in an hour and the window closes',
        })
        afirma('· a chair may proceed without a position, having said why',
               sin_esperar.returncode == 0, sin_esperar.stderr.strip())
        tarde = ejecuta(env, 'ops', 'floor-request', hilo2, {
            'basis': 'misrepresented', 'reason': 'that is not my view', 'evidence': [],
        })
        afirma('· non-happy: and one who said nothing has nothing to be misquoted about',
               tarde.returncode != 0 and 'submitted no position' in tarde.stderr,
               tarde.stderr.strip()[:200])
        ejecuta(env, 'seat', 'cancel', hilo2, {'reason': 'fixture'})

        decision = {
            'outcome': 'ship after staging replay',
            'rationale': 'migration and rollback evidence agree',
            'owner': 'alice', 'executor': 'seat', 'verifier': 'ops',
            'verificationQuestion': 'Can an independent clean replay and rollback pass?',
            'selectedEvidence': ['run 482', 'web e2e'],
            'decisiveContributors': ['api', 'web'],
            'rejectedOptions': ['ship without replay'],
            'dissent': ['banner timing remains uncertain'],
            'reopenIf': ['clean replay fails'],
        }
        unattributed = dict(decision)
        unattributed.pop('decisiveContributors')
        missing_attribution = ejecuta(env, 'seat', 'decide', thread, unattributed)
        afirma('· a chair must name which voices materially shaped the decision',
               missing_attribution.returncode != 0
               and 'decisiveContributors' in missing_attribution.stderr)
        wrong_attribution = ejecuta(env, 'seat', 'decide', thread, {
            **decision, 'decisiveContributors': ['unselected'],
        })
        afirma('· attribution cannot invent an unselected adviser',
               wrong_attribution.returncode != 0
               and 'not a selected contributor' in wrong_attribution.stderr)
        decided = ejecuta(env, 'seat', 'decide', thread, decision)
        afirma('· the chair records rationale, dissent and reopen conditions',
               valor(decided).get('progress', {}).get('status') == 'verifying')
        wrong_verifier = ejecuta(env, 'api', 'verify', thread, {
            'result': 'pass', 'evidence': ['trust me'], 'checks': ['none'],
        })
        afirma('· only the assigned independent verifier can attest',
               wrong_verifier.returncode != 0 and 'belongs to ops' in wrong_verifier.stderr)
        failed = ejecuta(env, 'ops', 'verify', thread, {
            'result': 'fail', 'evidence': ['clean DB replay failed at step 9'],
            'checks': ['fresh database', 'rollback'], 'residualRisks': ['lock timeout'],
        })
        afirma('· failed independent evidence blocks closure',
               valor(failed).get('progress', {}).get('status') == 'verification_failed')
        cannot_close = ejecuta(env, 'seat', 'close', thread, {'summary': 'done'})
        afirma('· the chair cannot close a failed verification',
               cannot_close.returncode != 0
               and 'only after verification passes' in cannot_close.stderr)
        replanned = ejecuta(env, 'seat', 'replan', thread, {
            'reason': 'fix step 9 and repeat the clean replay',
        })
        afirma('· failure creates a new controlled revision',
               valor(replanned).get('progress', {}).get('revision') == 2)
        afirma('· replanning still requires a fresh synthesis',
               ejecuta(env, 'seat', 'decide', thread, decision).returncode != 0)
        ejecuta(env, 'seat', 'synthesize', thread, {
            'summary': 'Step 9 fixed; original evidence plus new replay required',
            'agreements': ['repeat verification'], 'conflicts': [], 'unknowns': [],
        })
        ejecuta(env, 'seat', 'decide', thread, {
            **decision, 'rationale': 'step 9 fixed and re-synthesised',
            'selectedEvidence': ['run 482', 'fix step 9'],
        })
        passed = ejecuta(env, 'ops', 'verify', thread, {
            'result': 'pass', 'evidence': ['clean replay 483 and rollback passed'],
            'checks': ['fresh database', 'rollback'], 'residualRisks': [],
        })
        afirma('· a non-participant specialist can independently verify',
               passed.returncode == 0
               and valor(passed).get('progress', {}).get('status') == 'verified',
               passed.stderr.strip())
        closed = ejecuta(env, 'seat', 'close', thread, {
            'summary': 'Release approved after independent replay',
            'learnings': ['step 9 needs a permanent fixture'],
            'followups': ['add the fixture'],
        })
        afirma('· only a passed act closes',
               valor(closed).get('progress', {}).get('status') == 'closed')

        api_road = subprocess.run(
            ['node', CLIENT, 'bus', 'send', 'alice/elsewhere', 'hello'],
            capture_output=True, text=True, env=dict(env, CITY_BUS_ACTOR='api'), timeout=12)
        afirma('· repo credentials cannot cross a road',
               api_road.returncode != 0 and 'only the city chair' in api_road.stderr,
               api_road.stderr.strip())
        act_dir = os.path.join(city, 'deliberations', thread)
        act = open(os.path.join(act_dir, 'ACT.md'), encoding='utf-8').read()
        events = [json.loads(line) for line in open(
            os.path.join(act_dir, 'events.jsonl'), encoding='utf-8') if line.strip()]
        afirma('· the decision, verification and closure survive as a readable act',
               '## Decision' in act and '**PASS** by ops' in act and '## Closure' in act)
        afirma(
            '· the readable participant list preserves repo roles',
            'role data-engineer' in act and 'role seo' in act,
            act[:700],
        )
        afirma('· every transition is append-only auditable',
               len(events) >= 16 and events[-1]['type'] == 'committee.close',
               f'{len(events)} events')
        history = valor(ejecuta(env, 'seat', 'history'))
        # Indexed defensively: an earlier transition that stops working leaves
        # these lists empty, and an IndexError here would replace every failure
        # this suite had collected with a traceback about the last one.
        reciente = (history.get('recent') or [{}])[0]
        contribuyentes = (history.get('contributorCounts') or [{}])[0]
        afirma('· the chair gets concise cross-decision memory against capture',
               reciente.get('deliberation') == thread
               and contribuyentes.get('decisions') == 2
               and 'not proof of capture' in history.get('note', ''), str(history))
        denied_history = ejecuta(env, 'api', 'history')
        afirma('· decision influence history is chair-only',
               denied_history.returncode != 0
               and 'only the city chair' in denied_history.stderr)
        ai_list = valor(ejecuta(env, 'ai', 'list'))
        ops_list = valor(ejecuta(env, 'ops', 'list'))
        afirma('· unselected agents cannot browse the committee, but its verifier can',
               ai_list == [] and any(item.get('id') == thread for item in ops_list))
        cred_dir = os.path.join(app, '.runtime', 'bus', 'city-committee', 'actors')
        comprueba('· one bus identity exists for every configured runtime',
                  sorted(name[:-5] for name in os.listdir(cred_dir)
                         if name.endswith('.json')),
                  ['ai', 'api', 'ops', 'seat', 'web'])
    finally:
        para_hub(app)
        shutil.rmtree(base, ignore_errors=True)
    return resumen('committee')


if __name__ == '__main__':
    sys.exit(main())
