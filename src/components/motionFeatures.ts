/*
 * Motion's feature bundle, in a module of its own so that `import()` can split
 * it out of the main chunk. `domMax` rather than `domAnimation` because the
 * board and the shift view need layout animations and the sheets need drag.
 */
export { domMax as default } from 'motion/react'
