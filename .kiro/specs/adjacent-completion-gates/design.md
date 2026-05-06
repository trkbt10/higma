# Design

## Overview

Completion gates are process requirements, not renderer or editor runtime APIs. They live in a separate SDD spec so indexion does not force process vocabulary into product implementation files.

## Verification Scope

- Renderer alignment checks cover deck, buzz, and site renderer packages against the adjacent renderer plan requirements.
- Editor alignment checks cover deck, buzz, and site editor packages against the adjacent editor workspace requirements.
- Root validation covers lint, typecheck, test, diff checks, leak scans, and the absence of ignore directives or local sample references.
- Completion is recorded by checking the gate tasks only after all verification commands pass and committing the implementation plus SDD task state.
