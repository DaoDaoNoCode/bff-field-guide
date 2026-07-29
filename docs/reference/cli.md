# Go CLI Quick Reference

Every `go` command you will use while working on BFFs, organized by task. Each entry includes the command, what it does, the npm equivalent, and an example with expected output.

## Build and Run

### `go run .`

Compile and execute the current package in one step. Does not produce a binary -- compiles to a temp directory and runs immediately.

**npm equivalent:** `npx tsx src/index.ts`

```bash
cd packages/automl/bff                         # Navigate to the BFF directory
go run ./cmd --dev-mode --mock-k8s-client --mock-pipeline-server-client --mock-s3-client
                                                # Compile and start the server with mock clients
```

**What you should see:**

```
time=2024-01-01T10:00:00.000Z level=INFO msg="Server starting" port=4003
```

**Common flags:** Pass any flags your BFF accepts after `./cmd` -- they are forwarded to the compiled program.

---

### `go build ./...`

Compile all packages in the module. Checks for errors without producing a binary. The `./...` means "current directory and everything below it."

**npm equivalent:** `tsc --noEmit` (type-check without emitting output)

```bash
cd packages/automl/bff                         # Navigate to the BFF directory
go build ./...                                  # Compile everything
```

**What you should see:** No output at all. In Go, silence means success. Any compilation errors are printed to stderr.

**When to use it:** After editing any Go file, run this to check for compile errors before starting the server. It is much faster than `go run` because it does not execute anything.

---

### `go build -o app .`

Compile the current package into a standalone binary named `app`. This is what happens in CI/CD to produce deployment artifacts.

**npm equivalent:** `tsc && pkg .` (roughly -- compile and bundle)

```bash
cd packages/automl/bff
go build -o automl-bff ./cmd                   # Build a binary called 'automl-bff' from the cmd/ directory
ls -la automl-bff                              # The binary is a single file -- no node_modules needed
```

**What you should see:**

```
-rwxr-xr-x  1 user  staff  15728640 Jan  1 10:00 automl-bff
```

A single file, about 15 MB. It has zero runtime dependencies -- no Go installation needed to run it.

## Testing

### `go test ./...`

Run all tests in the module, recursively.

**npm equivalent:** `npx jest`

```bash
cd packages/automl/bff
go test ./...                                  # Run everything
```

**What you should see:**

```
ok      github.com/opendatahub-io/automl-library/bff/internal/api     0.5s
ok      github.com/opendatahub-io/automl-library/bff/internal/...     0.3s
```

Each line shows a package and how long its tests took.

---

### `go test -v ./internal/api/`

Run tests in a specific package with verbose output (show individual test names).

**npm equivalent:** `npx jest src/api/ --verbose`

```bash
cd packages/automl/bff
go test -v ./internal/api/                     # Verbose output for the api package only
```

**What you should see:**

```
=== RUN   TestCreateFeedbackHandler_Success
--- PASS: TestCreateFeedbackHandler_Success (0.00s)
=== RUN   TestCreateFeedbackHandler_Validation
=== RUN   TestCreateFeedbackHandler_Validation/missing_category
--- PASS: TestCreateFeedbackHandler_Validation/missing_category (0.00s)
...
PASS
```

Every test name, every sub-test, every pass/fail result.

---

### `go test -run TestName ./...`

Run only tests whose name matches the regex pattern.

**npm equivalent:** `npx jest -t "TestName"`

```bash
cd packages/automl/bff
go test -v -run TestCreateFeedback ./...       # Run tests matching "TestCreateFeedback"
go test -v -run "TestFoo/sub_test" ./...       # Run a specific sub-test
go test -v -run "TestUser|TestHealth" ./...    # Run tests matching either pattern
```

**What you should see:** Only the matching tests run. Others are skipped silently.

---

### `go test -count=1 ./...`

Disable test caching and force a re-run. Go caches test results by default -- if the code and test files have not changed, it uses the cached result.

**npm equivalent:** `npx jest --no-cache`

```bash
cd packages/automl/bff
go test -count=1 ./internal/api/               # Force re-run even if nothing changed
```

**When to use it:** When you suspect cached results are masking a flaky test, or when debugging timing-sensitive tests.

---

### `go test -cover ./...`

Show test coverage percentage for each package.

**npm equivalent:** `npx jest --coverage`

```bash
cd packages/automl/bff
go test -cover ./internal/api/                 # Show coverage for the api package
```

**What you should see:**

```
ok      .../internal/api  0.5s  coverage: 82.3% of statements
```

---

### `go test -race ./...`

Enable the race condition detector. Finds concurrent access bugs that would be invisible otherwise.

**npm equivalent:** None -- JavaScript is single-threaded.

```bash
cd packages/automl/bff
go test -race ./...                            # Check for race conditions
```

**When to use it:** When your code uses goroutines or shared state. The race detector slows tests down, so it is not used on every run, but CI often includes it.

---

### `go test -timeout 30s ./...`

Set a timeout for the entire test run. Default is 10 minutes.

**npm equivalent:** `jest.setTimeout(30000)` (per-test) or `--testTimeout=30000` (CLI)

```bash
cd packages/automl/bff
go test -timeout 30s ./internal/api/           # Fail if tests take more than 30 seconds
```

## Code Quality

### `go fmt ./...`

Format all Go files. There is no configuration -- everyone's Go code looks the same.

**npm equivalent:** `npx prettier --write .`

```bash
cd packages/automl/bff
go fmt ./...                                   # Format everything
```

**What you should see:** File paths of any files that were reformatted, or nothing if everything was already formatted.

::: tip gofmt Is Not Optional
Unlike Prettier, which is a team decision, `gofmt` is universally used. There is no `.prettierrc`, no style debates, no options. Everyone's Go code looks identical. CI will reject unformatted code. VS Code formats on save if the Go extension is configured.
:::

---

### `go vet ./...`

Static analysis -- catches common bugs that compile but are likely wrong.

**npm equivalent:** `npx eslint .`

```bash
cd packages/automl/bff
go vet ./...                                   # Check for common mistakes
```

**What you should see:** Nothing if everything is clean. Otherwise, warnings like:

```
./handler.go:42:2: fmt.Sprintf format %d has arg of wrong type string
```

**What it catches:** Printf format mismatches, unreachable code, suspicious struct tags, assignments to variables that are never read, and more.

---

### `gofmt -d .`

Show what formatting changes would be made, without actually writing them. Like a dry-run.

**npm equivalent:** `npx prettier --check .`

```bash
cd packages/automl/bff
gofmt -d internal/api/my_handler.go            # Show diff without modifying the file
```

**What you should see:** A diff showing what would change, or nothing if the file is already formatted.

## Modules and Dependencies

### `go mod init module-name`

Create a new Go module. Creates a `go.mod` file.

**npm equivalent:** `npm init -y`

```bash
go mod init github.com/my-org/my-module        # Create a new module
```

**What you should see:** A new `go.mod` file in the current directory. You will not need this for existing BFFs -- they already have `go.mod`.

---

### `go mod tidy`

Add missing dependencies and remove unused ones. This is the command you run after adding or removing an `import` in your code.

**npm equivalent:** `npm prune` + automatic install of missing packages

```bash
cd packages/automl/bff
go mod tidy                                    # Sync go.mod with your actual imports
```

**What you should see:** Updated `go.mod` and `go.sum` files. If nothing changed, no output.

**When to use it:** After adding a new `import` statement, after removing code that imported a package, or anytime `go build` complains about missing modules.

---

### `go mod download`

Download all dependencies listed in `go.mod`. Does not modify `go.mod`.

**npm equivalent:** `npm ci` (install exactly what the lockfile says)

```bash
cd packages/automl/bff
go mod download                                # Download all dependencies
```

**When to use it:** After cloning a repo or pulling changes that modified `go.mod`.

---

### `go get pkg@latest`

Add or update a specific dependency.

**npm equivalent:** `npm install pkg@latest`

```bash
cd packages/automl/bff
go get github.com/stretchr/testify@latest      # Add or update testify
go get github.com/stretchr/testify@v1.9.0      # Pin to a specific version
```

**What you should see:** Updated entries in `go.mod` and `go.sum`.

---

### `go list -m -u all`

Show all dependencies and which ones have updates available.

**npm equivalent:** `npm outdated`

```bash
cd packages/automl/bff
go list -m -u all                              # List all deps with update info
```

## Documentation

### `go doc`

View documentation for any Go package, type, or function right in the terminal.

**npm equivalent:** Looking up docs on MDN or npm package pages.

```bash
go doc fmt.Sprintf                             # Quick help for one function
go doc -all net/http                           # All exported functions in a package
go doc -src strings.Contains                   # View the actual source code
```

**What you should see (for `go doc fmt.Sprintf`):**

```
func Sprintf(format string, a ...any) string
    Sprintf formats according to a format specifier and returns the
    resulting string.
```

## Environment

### `go version`

Print the installed Go version.

```bash
go version
```

**What you should see:**

```
go version go1.26.0 darwin/arm64
```

---

### `go env`

Print Go environment variables. Useful for debugging path issues.

```bash
go env GOPATH                                  # Where Go stores packages
go env GOOS GOARCH                             # Current OS and architecture
```

**What you should see:**

```
/Users/you/go
darwin
arm64
```

## The `./...` Pattern

Many Go commands accept `./...` as a path argument. It means "the current directory and all subdirectories, recursively." This is the single most important Go CLI pattern to remember:

| Pattern | What It Matches | When To Use It |
|---------|----------------|----------------|
| `.` | Current directory only | When you only want one package |
| `./...` | Current directory and everything below it | When you want all packages (most common) |
| `./internal/...` | `internal/` and everything below it | When you want to scope to a subdirectory |
| `./internal/api/` | Only the `internal/api/` package (no subdirectories) | When you want exactly one package |

```bash
go test ./...                                  # Test everything in the module
go test ./internal/api/                        # Test only the api package
go fmt ./...                                   # Format everything in the module
go build ./...                                 # Check everything compiles
```
