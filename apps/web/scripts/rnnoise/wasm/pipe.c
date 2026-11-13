// WASM side of public/rnnoise/rnnoise.wasm. Same ABI as simple-rnnoise-wasm's
// src/worklet.c (MIT, see public/rnnoise/LICENSE), with the smallest fixed
// buffering that never runs dry.
//
// RNNoise consumes 480-sample frames; Web Audio delivers L-sample quanta.
// worklet.c waits for two whole frames before its first output, which with
// L = 128 delays the signal by 896 samples on top of RNNoise's own 480.
// The minimum is 480 - gcd(480, L): after k quanta with D samples of leading
// silence the processed count is (D + kL) rounded down to a multiple of 480,
// which covers the kL samples owed exactly when (D + kL) mod 480 <= D, and
// (D + kL) mod 480 never exceeds 480 - gcd(480, L). For L = 128 that is 448.
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <rnnoise.h>

#define FRAME_SIZE 480
#define MAX_FRAME_SIZE 16384

static const float scale = -INT16_MIN;

struct State
{
    float buffer[MAX_FRAME_SIZE * 2], vad_prob;
    size_t input, processed, output, started;
    DenoiseState *state;
};

static size_t gcd(size_t a, size_t b)
{
    while (b)
    {
        size_t t = a % b;
        a = b;
        b = t;
    }
    return a;
}

struct State *EMSCRIPTEN_KEEPALIVE newState()
{
    struct State *s = malloc(sizeof(struct State));
    s->vad_prob = 0;
    s->started = s->output = s->processed = s->input = 0;
    s->state = rnnoise_create(NULL);
    return s;
}

void EMSCRIPTEN_KEEPALIVE deleteState(struct State *const state)
{
    rnnoise_destroy(state->state);
    free(state);
}

float *EMSCRIPTEN_KEEPALIVE getInput(struct State *const state)
{
    if (state->output && state->input > MAX_FRAME_SIZE)
    {
        memmove(state->buffer, &state->buffer[state->output], sizeof(float) * (state->input -= state->output));
        state->processed -= state->output;
        state->output = 0;
    }
    return &state->buffer[state->input];
}

float EMSCRIPTEN_KEEPALIVE getVadProb(const struct State *const state) { return state->vad_prob; }

float *EMSCRIPTEN_KEEPALIVE pipe(struct State *const state, size_t length)
{
    if (!state->started)
    {
        // Lead the stream with the minimal silence; the first quantum was
        // written at buffer[0] and moves after it.
        size_t delay = FRAME_SIZE - gcd(FRAME_SIZE, length);
        memmove(&state->buffer[delay], state->buffer, sizeof(float) * length);
        memset(state->buffer, 0, sizeof(float) * delay);
        state->input = delay;
        state->started = 1;
    }
    for (size_t end = state->input + length; state->input < end; ++state->input)
        state->buffer[state->input] *= scale;
    while (state->processed + FRAME_SIZE <= state->input)
    {
        state->vad_prob = rnnoise_process_frame(state->state, &state->buffer[state->processed], &state->buffer[state->processed]);
        state->processed += FRAME_SIZE;
    }
    if (state->output + length > state->processed)
        return NULL;
    size_t o = state->output;
    for (size_t end = state->output + length; state->output < end; ++state->output)
        state->buffer[state->output] /= scale;
    return &state->buffer[o];
}
