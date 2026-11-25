/// <reference types="vite/client" />

// `src/shared/types.ts` augments Window with the typed `dshRemote` bridge.
// Importing it here keeps that global declaration visible to the renderer even
// when this file is type-checked in isolation (for example by an editor).
import '@shared/types'
import type { DshPetApi } from '@shared/pet'

declare global {
  interface Window {
    dshPet: DshPetApi
  }
}

export {}