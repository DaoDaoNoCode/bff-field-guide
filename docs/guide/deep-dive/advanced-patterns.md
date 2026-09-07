# Advanced Patterns

> **Beyond the basics** -- streaming responses, BFF-to-BFF calls, and goroutines -- the patterns you'll encounter in the gen-ai and model-serving BFFs.

Everything you've learned so far follows a clean request-response cycle: request in, middleware runs, handler fetches data, handler writes JSON, done. But the gen-ai chatbot streams LLM tokens in real time. The gen-ai BFF calls the maas BFF for API keys. And some handlers fire off multiple service calls in parallel. These patterns bend the rules -- and once you see how, you'll be ready for the most complex parts of the codebase.

## Streaming with Server-Sent Events (SSE)

When a user sends a message in the chatbot playground, they don't wait for the full response. Tokens stream in one by one, just like ChatGPT. The BFF uses Server-Sent Events (SSE) to push each token to the browser as it arrives from LlamaStack.

Here's the core pattern, simplified from `lsd_responses_handler.go`:

```go
func (app *App) handleStreamingResponse(
    w http.ResponseWriter,                         // Response writer -- but we won't use WriteJSON
    r *http.Request,
    ctx context.Context,
    params llamastack.CreateResponseParams,
) {
    // 1. Check that the ResponseWriter supports streaming
    flusher, ok := w.(http.Flusher)                // Type assertion: "do you implement Flusher?"
    if !ok {                                       // If not, we can't stream
        http.Error(w, "Streaming not supported", http.StatusNotImplemented)
        return                                     // Stop -- nothing else we can do
    }

    // 2. Create the upstream stream to LlamaStack
    stream, err := app.repositories.Responses.CreateResponseStream(ctx, params)
    if err != nil {
        app.handleLlamaStackClientError(w, r, err) // Regular error response -- still request/response
        return
    }
    defer stream.Close()                           // Clean up when handler exits

    // 3. Set SSE headers -- this switches the connection to streaming mode
    w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
    w.Header().Set("Cache-Control", "no-cache, no-transform")
    w.Header().Set("Connection", "keep-alive")
    w.Header().Set("X-Accel-Buffering", "no")      // Tell Nginx not to buffer

    // 4. Stream events as they arrive
    for stream.Next() {                            // Like a database cursor -- one event at a time
        select {
        case <-ctx.Done():                         // Client disconnected?
            return                                 // Stop streaming, clean up
        default:                                   // Still connected, keep going
        }

        event := stream.Current()                  // Get the current event from LlamaStack
        streamingEvent := convertToStreamingEvent(event) // Convert to our clean schema
        if streamingEvent == nil {
            continue                               // Skip event types we don't care about
        }

        eventData, err := json.Marshal(streamingEvent) // Serialize to JSON
        if err != nil {
            continue                               // Skip events that fail to serialize
        }

        fmt.Fprintf(w, "data: %s\n\n", eventData) // SSE format: "data: {...}\n\n"
        flusher.Flush()                            // Send immediately -- don't buffer!
    }
}
```

If you've used `res.write()` in Express, this will look familiar. In Express you'd write:

```typescript
res.setHeader('Content-Type', 'text/event-stream');
res.write(`data: ${JSON.stringify(event)}\n\n`);
res.flush();  // If using compression middleware
```

The Go version does the same thing, but `http.Flusher` deserves a closer look. By default, Go's `http.ResponseWriter` buffers output for efficiency. The `Flusher` interface lets you say "send what I've written right now." Without it, the client would see nothing until the entire stream completes -- defeating the purpose.

::: tip The SSE Wire Format
SSE is simple text. Each event is `data: <payload>\n\n` (two newlines). The browser's `EventSource` API or a `fetch()` with a streaming reader parses this automatically. No WebSocket upgrade, no binary protocol.
:::

Three things make SSE handlers different from regular handlers:

**No `WriteJSON`.** You write directly to `w` with `fmt.Fprintf`. The `WriteJSON` helper sets `Content-Type: application/json` and writes a single response -- SSE needs `text/event-stream` and sends many messages over the same connection.

**The handler is long-lived.** A normal handler runs for milliseconds. An SSE handler holds the connection open for as long as the LLM is generating tokens -- potentially minutes. The `for stream.Next()` loop is the handler's heartbeat.

**Context cancellation matters more.** When the user closes the browser tab, `ctx.Done()` fires. Without that `select` check, the handler would keep reading from LlamaStack even though nobody is listening, wasting resources on both sides.

::: warning Middleware Still Runs First
The SSE handler doesn't bypass the middleware chain. Auth, namespace validation, and RBAC all execute before streaming starts. The user is fully authenticated and authorized before the first token flows. The "special" part is only what happens inside the handler itself.
:::

## Inter-BFF Communication

The gen-ai BFF needs API keys from the maas BFF, so it calls the maas BFF's token endpoint directly -- BFF-to-BFF HTTP over the `bffclient` package, forwarding the user's own token so the target enforces RBAC as that user. It's the same factory-and-interface pattern you saw for upstream [integrations](./integrations), just pointed at another BFF instead of an external service.

This is a big enough topic -- service discovery, `BFF_<TARGET>_*` env vars, `user_token` vs `internal` auth (and its security implications), `MOCK_BFF_CLIENTS`, structured error codes, and the special case of calling core-bff -- that it has its own chapter.

➡️ **[Inter-BFF Communication](./inter-bff-communication)** -- the full deep dive.

## Goroutines: Concurrent Service Calls

When a handler needs data from multiple independent sources, goroutines let you call them in parallel instead of sequentially. The gen-ai BFF uses this pattern extensively for async output moderation -- checking guardrail compliance on chunks of streamed text while continuing to receive new tokens.

Here's the fundamental pattern, simplified from `token_k8s_client.go`:

```go
func (kc *Client) GetAAModels(
    ctx context.Context, namespace string,
) ([]models.AAModel, error) {
    g, gCtx := errgroup.WithContext(ctx)           // Create an error group tied to context
    var fromInfSvc, fromLLMInfSvc, fromExternal []models.AAModel

    g.Go(func() (err error) {                      // Goroutine 1: fetch inference service models
        fromInfSvc, err = kc.getAAModelsFromInferenceService(gCtx, namespace, labelSelector)
        return err                                 // errgroup collects the error for you
    })

    g.Go(func() (err error) {                      // Goroutine 2: fetch LLM inference service models
        fromLLMInfSvc, err = kc.getAAModelsFromLLMInferenceService(gCtx, namespace, labelSelector)
        return err
    })

    g.Go(func() (err error) {                      // Goroutine 3: fetch external models
        fromExternal, err = kc.getExternalModels(gCtx, namespace)
        return err
    })

    if err := g.Wait(); err != nil {               // Block until all goroutines complete
        return nil, err                            // If ANY goroutine failed, return the first error
    }

    // All results are ready -- combine and return
    return append(append(fromInfSvc, fromLLMInfSvc...), fromExternal...), nil
}
```

If you know `Promise.all()` in JavaScript, you already understand this. The `errgroup` package (from `golang.org/x/sync/errgroup`) is Go's standard tool for structured concurrency: `g.Go()` launches a goroutine, and `g.Wait()` blocks until all goroutines complete, returning the first error encountered. Unlike a bare `sync.WaitGroup`, errgroup also cancels the shared context (`gCtx`) when any goroutine fails, so the remaining goroutines can exit early instead of doing wasted work.

In the real codebase, the `async_moderation.go` file shows a more sophisticated version. The `ModerateChunkAsync` method fires off goroutines to check text chunks against NeMo guardrails while the stream continues:

```go
// From async_moderation.go -- simplified
func (s *AsyncModerationState) ModerateChunkAsync(
    app *App, chunk *ModerationChunk, opts nemo.GuardrailsOptions,
) {
    go func() {                                    // Fire and forget -- runs concurrently
        result := AsyncModerationResult{SequenceNum: chunk.SequenceNum}

        select {
        case <-s.ctx.Done():                       // Context cancelled? Don't bother
            return
        default:
        }

        // Call the guardrails service (this is the slow I/O part)
        modResult, err := app.checkModeration(s.ctx,
            []nemo.Message{{Role: nemo.RoleAssistant, Content: chunk.Text}},
            opts)

        if err != nil {
            result.Safe = false                    // Fail closed: if guardrails are down, block
            result.ViolationReason = "guardrail service error"
        } else if modResult.Flagged {
            result.Safe = false
            result.ViolationReason = modResult.ViolationReason
        } else {
            result.Safe = true
        }

        select {
        case s.resultChan <- result:               // Send result to the processor
        case <-s.ctx.Done():                       // Context cancelled, discard result
        }
    }()
}
```

When multiple goroutines access shared state (like the chunk map), a `sync.Mutex` prevents race conditions -- Go's answer to JavaScript's single-threaded safety, made explicit.

::: warning When NOT to Use Goroutines
If calls depend on each other (e.g., you need the OGXServer URL before calling LlamaStack), do them sequentially. Goroutines are for independent, concurrent work. Most BFF handlers don't need them -- the middleware chain handles sequential dependencies. Reach for goroutines only when you have multiple independent I/O calls that would otherwise waste time waiting one after another.
:::

::: tip Key Takeaway
These three patterns -- SSE streaming, inter-BFF calls, and goroutines -- build on the same handler foundation you already know. SSE replaces `WriteJSON` with direct writes and `Flusher.Flush()`. Inter-BFF uses the same factory-and-interface pattern as upstream service clients, with the user's token forwarded. Goroutines let you call multiple services in parallel using `errgroup`, with `sync.Mutex` protecting shared state. Start with the standard request-response pattern; reach for these when you need them.
:::

::: info See Also
- [Writing Handlers](./handlers) -- the standard request-response pattern these build on
- [Integrations](./integrations) -- how service clients are created and injected
- [Inter-BFF Communication](./inter-bff-communication) -- the full BFF-to-BFF deep dive
- [Middleware Chain](./middleware) -- the middleware that runs before any of these patterns
:::
