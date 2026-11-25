import { fitWithin } from './photos'

describe('fitWithin', () => {
  it('scales the long edge down and never up', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 })
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10000, 5, 320)).toEqual({ width: 320, height: 1 })
  })
})
