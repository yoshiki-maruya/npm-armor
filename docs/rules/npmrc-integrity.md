# AR009 — npmrc-integrity

**Default severity:** error

**Attack references:** project-npmrc-abuse

The project .npmrc contains no dangerous settings or plaintext credentials.

A project-level .npmrc travels with the repository, so anyone who can
land a commit — or a git dependency, see AR003 — can change how your
package manager behaves on every machine that clones it. Four settings
turn it into an attack vector:

- registry / @scope:registry overrides redirect installs to an
  attacker-controlled server;
- strict-ssl=false disables TLS verification, enabling on-path
  tampering;
- script-shell swaps the interpreter that runs lifecycle scripts;
- plaintext _authToken/_auth/_password values leak credentials to
  everyone with repo access (use ${ENV_VAR} references instead, and
  revoke any token that was ever committed).

`armor fix` repairs strict-ssl=false (to true). Registry overrides and
credentials are reported only: a legitimate corporate mirror should be
acknowledged via this rule's options, and a leaked token must be
revoked by a human, not edited away.
