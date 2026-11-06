package lelu.authz

import rego.v1

# ==========================================================
# LÉLU — AUTHORIZATION POLICY
#
# The server-side decision point. It is a faithful mirror of
# src/core/security/policy.ts (the reference implementation), and
# tests/policy-parity.test.ts runs both on the same inputs so a
# divergence fails the suite rather than silently widening or
# narrowing what LÉLU may do.
#
# Precedence is expressed as a numbered stage ladder: the FIRST
# triggered rule is the reason reported, exactly like the
# reference implementation's early returns. A number is used
# instead of a chain of negations so adding a rule cannot
# accidentally reorder the ones before it.
# ==========================================================

min_autonomy := {
	"READ": 0,
	"WRITE": 2,
	"EXECUTE": 3,
	"ACCESS_EXTERNAL_DEVICE": 3,
	"INSTALL": 4,
	"DELETE": 4,
	"DEPLOY": 5,
	"ADMINISTER": 5,
}[input.action]

risk := {
	"READ": "low",
	"WRITE": "medium",
	"EXECUTE": "high",
	"ACCESS_EXTERNAL_DEVICE": "high",
	"INSTALL": "critical",
	"DELETE": "critical",
	"DEPLOY": "critical",
	"ADMINISTER": "critical",
}[input.action]

# An OBJECT, not a set: a set membership test used as a decision value is
# undefined when the action is not in it, and an undefined value inside the
# decision object makes the whole decision undefined.
approval_actions := {"INSTALL": true, "DELETE": true, "DEPLOY": true, "ADMINISTER": true}
device_actions := {"READ", "ACCESS_EXTERNAL_DEVICE"}
agent_forbidden := {"ADMINISTER", "DEPLOY"}
owned_actions := {"WRITE", "DELETE"}

identified if {
	input.subject.kind == "user"
	input.subject.user_id != ""
}

identified if {
	input.subject.kind == "agent"
	input.subject.agent_id != ""
}

identified if {
	input.subject.kind == "service"
	input.subject.session_id != ""
}

identified if {
	input.subject.kind == "device"
	input.subject.session_id != ""
}

self_elev := input.context.agent_self_elevation == true

missing_identity if {
	not identified
}

device_bad if {
	input.subject.kind == "device"
	not device_actions[input.action]
}

agent_bad if {
	input.subject.kind == "agent"
	agent_forbidden[input.action]
}

cross_user if {
	input.subject.kind == "user"
	input.resource.owner_id != ""
	owned_actions[input.action]
	input.resource.owner_id != input.subject.user_id
}

low_autonomy := input.context.autonomy_level < min_autonomy

prod_low if {
	input.context.environment == "production"
	input.context.autonomy_level < 5
}

device_rel if {
	input.action == "ACCESS_EXTERNAL_DEVICE"
	not input.context.device_authorized
}

deploy_appr if {
	input.action == "DEPLOY"
	not input.context.approval_valid
}

# object.get, not a bare lookup: a bare lookup is UNDEFINED for an action
# that does not need approval, and an undefined value inside the decision
# object makes the whole rule undefined — the query then returns nothing
# at all and every request would look like a policy error.
needs_approval := object.get(approval_actions, input.action, false)

missing_approval if {
	needs_approval == true
	not input.context.approval_valid
}

triggered contains 1 if self_elev
triggered contains 2 if missing_identity
triggered contains 3 if device_bad
triggered contains 4 if agent_bad
triggered contains 5 if cross_user
triggered contains 6 if low_autonomy
triggered contains 7 if prod_low
triggered contains 8 if device_rel
triggered contains 9 if deploy_appr
triggered contains 10 if missing_approval

first := min(triggered) if count(triggered) > 0

rule_for_stage := {
	1: "deny_self_elevation",
	2: "deny_no_identity",
	3: "deny_device_action",
	4: "deny_agent_action",
	5: "deny_cross_user",
	6: "deny_autonomy",
	7: "deny_production_autonomy",
	8: "deny_device_relationship",
	9: "deny_deploy_approval",
	10: "deny_missing_approval",
}

reason_for_stage := {
	1: "An agent may never elevate its own privileges.",
	2: sprintf("No identified %s subject — anonymous execution is refused.", [input.subject.kind]),
	3: sprintf("A device subject may not %s; that needs a user or an agent.", [input.action]),
	4: sprintf("An agent may not %s — only the user may.", [input.action]),
	5: sprintf("Cross-user access refused: %s \"%s\" belongs to another user.", [input.resource.kind, input.resource.id]),
	6: sprintf("%s requires autonomy level %d; the current level is %d.", [input.action, min_autonomy, input.context.autonomy_level]),
	7: "Production actions require autonomy level 5.",
	8: "Device access refused: no authorized relationship to that device.",
	9: "Deployment refused: no human approval covers this call.",
	10: sprintf("%s needs an explicit human approval; none is live for this call.", [input.action]),
}

decision := {
	"allowed": false,
	"requires_approval": first == 10,
	"reason": reason_for_stage[first],
	"risk": risk,
	"rules": [rule_for_stage[first]],
} if count(triggered) > 0

decision := {
	"allowed": true,
	"requires_approval": needs_approval,
	"reason": sprintf("Permitted: %s may %s %s \"%s\" at autonomy %d.", [input.subject.kind, input.action, input.resource.kind, input.resource.id, input.context.autonomy_level]),
	"risk": risk,
	"rules": ["permitted"],
} if count(triggered) == 0
