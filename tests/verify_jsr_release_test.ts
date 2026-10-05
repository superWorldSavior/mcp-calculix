import { assertEquals, assertThrows } from "@std/assert";
import {
  parseReleaseArguments,
  type ProvenanceStatement,
  type ReleaseRequest,
  verifyReleaseProvenance,
} from "../scripts/verify-jsr-release.ts";

const VERSION = "0.8.6";
const COMMIT = "a".repeat(40);
const PERSONAL_REPOSITORY = "superWorldSavior/mcp-calculix";
const HISTORICAL_REPOSITORY = "Casys-AI/mcp-calculix";
const PACKAGE = "@casys/mcp-calculix";

function request(repository = PERSONAL_REPOSITORY): ReleaseRequest {
  return parseReleaseArguments([
    "/checkout",
    VERSION,
    COMMIT,
    "--repository",
    repository,
  ]);
}

function statement(repository = PERSONAL_REPOSITORY): ProvenanceStatement {
  const repositoryUrl = `https://github.com/${repository}`;
  return {
    type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{
      name: `pkg:jsr/${PACKAGE}@${VERSION}`,
      digest: { sha256: "b".repeat(64) },
    }],
    predicate: {
      buildDefinition: {
        resolvedDependencies: [{
          uri: `git+${repositoryUrl}@refs/tags/v${VERSION}`,
          digest: { gitCommit: COMMIT },
        }],
        externalParameters: {
          workflow: {
            ref: `refs/tags/v${VERSION}`,
            repository: repositoryUrl,
            path: ".github/workflows/publish.yml",
          },
        },
      },
    },
  };
}

Deno.test("JSR release uses the current GitHub repository context", () => {
  const parsed = parseReleaseArguments(
    ["/checkout", VERSION, COMMIT],
    PERSONAL_REPOSITORY,
  );
  assertEquals(parsed.repository, PERSONAL_REPOSITORY);
  verifyReleaseProvenance(statement(), PACKAGE, parsed);
});

Deno.test("historical JSR release uses an explicit repository override", () => {
  const historical = parseReleaseArguments(
    ["/checkout", VERSION, COMMIT, "--repository", HISTORICAL_REPOSITORY],
    PERSONAL_REPOSITORY,
  );
  assertEquals(historical.repository, HISTORICAL_REPOSITORY);
  verifyReleaseProvenance(
    statement(HISTORICAL_REPOSITORY),
    PACKAGE,
    historical,
  );
  assertThrows(
    () => verifyReleaseProvenance(statement(), PACKAGE, historical),
    Error,
    "does not bind",
  );
});

Deno.test("personal JSR verification rejects a historical source identity", () => {
  assertThrows(
    () =>
      verifyReleaseProvenance(
        statement(HISTORICAL_REPOSITORY),
        PACKAGE,
        request(),
      ),
    Error,
    "does not bind",
  );
});

Deno.test("JSR release requires an explicit or current repository", () => {
  assertThrows(
    () => parseReleaseArguments(["/checkout", VERSION, COMMIT]),
    Error,
    "Pass --repository",
  );
  for (
    const repository of [
      "https://github.com/Casys-AI/mcp-calculix",
      "owner/repository/extra",
      "owner/..",
      "owner/repository?ref=main",
      "owner\\repository",
    ]
  ) {
    assertThrows(() => request(repository), Error, "owner/name format");
  }
});

Deno.test("JSR release keeps the exact commit and argument guards", () => {
  for (const commit of ["a".repeat(39), "A".repeat(40), "main"]) {
    assertThrows(
      () =>
        parseReleaseArguments(
          ["/checkout", VERSION, commit],
          PERSONAL_REPOSITORY,
        ),
      Error,
      "full lowercase SHA-1",
    );
  }
  for (
    const args of [
      [],
      ["/checkout", VERSION, COMMIT, "--repository"],
      ["/checkout", VERSION, COMMIT, "--unknown", PERSONAL_REPOSITORY],
      [
        "/checkout",
        VERSION,
        COMMIT,
        "--repository",
        PERSONAL_REPOSITORY,
        "extra",
      ],
    ]
  ) {
    assertThrows(
      () => parseReleaseArguments(args, PERSONAL_REPOSITORY),
      Error,
      "Usage:",
    );
  }
});

const invalidSubjects = [
  { name: `pkg:jsr/${PACKAGE}@0.0.0`, digest: { sha256: "b".repeat(64) } },
  { name: `pkg:jsr/${PACKAGE}@${VERSION}`, digest: { sha256: "b".repeat(63) } },
  { name: `pkg:jsr/${PACKAGE}@${VERSION}`, digest: { sha256: "B".repeat(64) } },
];
for (const [index, subject] of invalidSubjects.entries()) {
  Deno.test(`JSR release rejects a wrong subject or digest (${index})`, () => {
    const provenance = statement();
    provenance.subject = [subject];
    assertThrows(
      () => verifyReleaseProvenance(provenance, PACKAGE, request()),
      Error,
      "Provenance subject does not bind",
    );
  });
}

for (const identity of ["tag", "commit"]) {
  Deno.test(`JSR release keeps the exact source ${identity} guard`, () => {
    const provenance = statement();
    const source =
      provenance.predicate!.buildDefinition!.resolvedDependencies![0];
    if (identity === "tag") {
      source.uri = source.uri!.replace(`v${VERSION}`, "v0.0.0");
    } else {
      source.digest!.gitCommit = "c".repeat(40);
    }
    assertThrows(
      () => verifyReleaseProvenance(provenance, PACKAGE, request()),
      Error,
      "JSR provenance does not bind",
    );
  });
}

for (const identity of ["repository", "ref", "path", "type", "predicateType"]) {
  Deno.test(`JSR release keeps the publishing workflow ${identity} guard`, () => {
    const provenance = statement();
    const workflow = provenance.predicate!.buildDefinition!.externalParameters!
      .workflow!;
    if (identity === "repository") {
      workflow.repository = `https://github.com/${HISTORICAL_REPOSITORY}`;
    } else if (identity === "ref") {
      workflow.ref = "refs/heads/main";
    } else if (identity === "path") {
      workflow.path = ".github/workflows/other.yml";
    } else if (identity === "type") {
      provenance.type = "https://in-toto.io/Statement/v0.1";
    } else {
      provenance.predicateType = "https://slsa.dev/provenance/v0.2";
    }
    assertThrows(
      () => verifyReleaseProvenance(provenance, PACKAGE, request()),
      Error,
      "unexpected publishing workflow",
    );
  });
}
