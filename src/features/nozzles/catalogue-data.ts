/**
 * Catalogue library — Trouvay & Cauvin "Piping Equipment 2001" (PDF in the project's source documents).
 * Generated from the catalogue tables; edit by regenerating, not by hand.
 *
 *  - CAT_PIPE   : ASME B36.10M-1996, every wall thickness per DN (PDF pp.18-27). kg/m is the catalogue value.
 *                 Label STD / XS / XXS is reliable. The schedule NUMBERS are not stored (they could not be read reliably):
 *                 select by wall thickness instead.
 *  - CAT_FLANGE : ASME B16.5-1996 flanges, classes 150-2500, DN15-DN600 (PDF pp.173-179). Weights in kg are
 *                 "approximate" according to the catalogue. Classes 1500 and 2500 carry the WN weight only.
 *                 The catalogue has no DN90 flange, class 400 starts at DN100, class 900 at DN80.
 *  - Not in the catalogue: reinforcing-pad sizes, API-650 tables, projections. These stay inputs.
 */

export type FlangeType = "WN" | "SO" | "LAP" | "THR" | "BLIND";
export type PipeLabel = "STD" | "XS" | "XXS";
export const FLANGE_TYPES: FlangeType[] = ["WN", "SO", "LAP", "THR", "BLIND"];
export const FLANGE_CLASSES = [150, 300, 400, 600, 900, 1500, 2500] as const;

/** [wall mm, kg/m, label | null] */
export type PipeWall = readonly [number, number, PipeLabel | null];
export interface CatPipe { od: number; walls: readonly PipeWall[] }

export interface CatFlange {
  od: number; thk: number; rfDia: number;
  holes: number | null; boltCircle: number | null; holeDia: number | null;
  /** Weld-neck overall length (hub), mm. */
  hubLen: number;
  /** Weights, kg. Missing = not tabulated. */
  w: Partial<Record<FlangeType, number>>;
}

export const CAT_PIPE: Record<number, CatPipe> = {
  6: { od: 10.3, walls: [[1.24,0.28,null],[1.45,0.32,null],[1.73,0.37,"STD"],[2.41,0.47,"XS"]] },
  8: { od: 13.7, walls: [[1.65,0.49,null],[1.85,0.54,null],[2.24,0.63,"STD"],[3.02,0.8,"XS"]] },
  10: { od: 17.1, walls: [[1.65,0.63,null],[1.85,0.7,null],[2.31,0.84,"STD"],[3.2,1.1,"XS"]] },
  15: { od: 21.3, walls: [[1.65,0.8,null],[2.11,1.0,null],[2.41,1.12,null],[2.77,1.27,"STD"],[3.73,1.62,"XS"],[4.78,1.95,null],[7.47,2.55,"XXS"]] },
  20: { od: 26.7, walls: [[1.65,1.03,null],[2.11,1.28,null],[2.41,1.44,null],[2.87,1.69,"STD"],[3.91,2.2,"XS"],[5.56,2.9,null],[7.82,3.64,"XXS"]] },
  25: { od: 33.4, walls: [[1.65,1.3,null],[2.77,2.09,null],[2.9,2.18,null],[3.38,2.5,"STD"],[4.55,3.24,"XS"],[6.35,4.24,null],[9.09,5.45,"XXS"]] },
  32: { od: 42.2, walls: [[1.65,1.65,null],[2.77,2.7,null],[2.97,2.87,null],[3.56,3.39,"STD"],[4.85,4.47,"XS"],[6.35,5.61,null],[9.7,7.77,"XXS"]] },
  40: { od: 48.3, walls: [[1.65,1.91,null],[2.77,3.11,null],[3.18,3.53,null],[3.68,4.05,"STD"],[5.08,5.41,"XS"],[7.14,7.25,null],[10.15,9.56,"XXS"]] },
  50: { od: 60.3, walls: [[1.65,2.4,null],[2.11,3.03,null],[2.77,3.93,null],[3.18,4.48,null],[3.58,5.01,null],[3.91,5.44,"STD"],[4.37,6.03,null],[4.78,6.54,null],[5.54,7.48,"XS"],[6.35,8.45,null],[7.14,9.36,null],[8.74,11.11,null],[11.07,13.44,"XXS"]] },
  65: { od: 73.0, walls: [[2.11,3.69,null],[2.77,4.8,null],[3.05,5.26,null],[3.18,5.48,null],[3.58,6.13,null],[3.96,6.74,null],[4.37,7.4,null],[4.78,8.04,null],[5.16,8.63,"STD"],[5.49,9.14,null],[6.35,10.44,null],[7.01,11.41,"XS"],[9.53,14.92,null],[14.02,20.39,"XXS"]] },
  80: { od: 88.9, walls: [[2.11,4.52,null],[2.77,5.88,null],[3.05,6.45,null],[3.18,6.72,null],[3.58,7.53,null],[3.96,8.29,null],[4.37,9.11,null],[4.78,9.92,null],[5.49,11.29,"STD"],[6.35,12.93,null],[7.14,14.4,null],[7.62,15.27,"XS"],[11.13,21.35,null],[15.24,27.68,"XXS"]] },
  90: { od: 101.6, walls: [[2.11,5.18,null],[2.77,6.75,null],[3.05,7.4,null],[3.18,7.72,null],[3.58,8.65,null],[3.96,9.53,null],[4.37,10.48,null],[4.78,11.41,null],[5.74,13.57,"STD"],[6.35,14.92,null],[7.14,16.63,null],[8.08,18.63,"XS"]] },
  100: { od: 114.3, walls: [[2.11,5.84,null],[2.77,7.62,null],[3.05,8.36,null],[3.18,8.71,null],[3.58,9.77,null],[3.96,10.78,null],[4.37,11.85,null],[4.78,12.91,null],[5.16,13.89,null],[5.56,14.91,null],[6.02,16.07,"STD"],[6.35,16.9,null],[7.14,18.87,null],[7.92,20.78,null],[8.56,22.32,"XS"],[11.13,28.32,null],[13.49,33.54,null],[17.12,41.03,"XXS"]] },
  125: { od: 141.3, walls: [[2.11,7.24,null],[2.77,9.47,null],[3.18,10.83,null],[3.4,11.57,null],[3.96,13.41,null],[4.78,16.09,null],[5.56,18.61,null],[6.55,21.77,"STD"],[7.14,23.62,null],[7.92,26.05,null],[8.74,28.57,null],[9.53,30.97,"XS"],[12.7,40.28,null],[15.88,49.11,null],[19.05,57.43,"XXS"]] },
  150: { od: 168.3, walls: [[2.11,8.65,null],[2.77,11.31,null],[3.18,12.95,null],[3.4,13.84,null],[3.58,14.54,null],[3.96,16.05,null],[4.37,17.67,null],[4.78,19.27,null],[5.16,20.76,null],[5.56,22.31,null],[6.35,25.36,null],[7.11,28.26,"STD"],[7.92,31.32,null],[8.74,34.39,null],[9.53,37.31,null],[10.97,42.56,"XS"],[12.7,48.73,null],[14.27,54.2,null],[15.88,59.69,null],[18.26,67.56,null],[19.05,70.11,null],[21.95,79.22,"XXS"],[22.23,80.07,null]] },
  200: { od: 219.1, walls: [[2.77,14.79,null],[3.18,16.93,null],[3.76,19.96,null],[3.96,21.01,null],[4.78,25.26,null],[5.16,27.22,null],[5.56,29.28,null],[6.35,33.31,null],[7.04,36.81,null],[7.92,41.24,null],[8.18,42.55,"STD"],[8.74,45.34,null],[9.53,49.25,null],[10.31,53.08,null],[11.13,57.08,null],[12.7,64.64,"XS"],[14.27,72.08,null],[15.09,75.92,null],[15.88,79.58,null],[18.26,90.44,null],[19.05,93.98,null],[20.62,100.92,null],[22.23,107.92,"XXS"],[23.01,111.27,null],[25.4,121.33,null]] },
  250: { od: 273.0, walls: [[3.4,22.63,null],[3.96,26.28,null],[4.19,27.78,null],[4.78,31.63,null],[5.16,34.09,null],[5.56,36.68,null],[6.35,41.77,null],[7.09,46.51,null],[7.8,51.03,null],[8.74,56.98,null],[9.27,60.31,"STD"],[11.13,71.9,null],[12.7,81.55,"XS"],[14.27,91.08,null],[15.09,96.01,null],[15.88,100.73,null],[18.26,114.75,null],[20.62,128.38,null],[21.44,133.06,null],[22.23,137.52,null],[23.83,146.48,null],[25.4,155.15,"XXS"],[28.58,172.33,null],[31.75,188.97,null]] },
  300: { od: 323.8, walls: [[3.96,31.25,null],[4.37,34.43,null],[4.57,36.0,null],[4.78,37.62,null],[5.16,40.56,null],[5.56,43.65,null],[6.35,49.73,null],[7.14,55.77,null],[7.92,61.71,null],[8.38,65.2,null],[8.74,67.93,null],[9.53,73.88,"STD"],[10.31,79.73,null],[11.13,85.84,null],[12.7,97.46,"XS"],[14.27,108.96,null],[15.88,120.62,null],[17.48,132.08,null],[19.05,143.21,null],[20.62,154.21,null],[21.44,159.91,null],[22.23,165.37,null],[23.83,176.33,null],[25.4,186.97,"XXS"],[26.97,197.48,null],[28.58,208.14,null],[31.75,228.74,null],[33.32,238.76,null]] },
  350: { od: 355.6, walls: [[3.96,34.36,null],[4.78,41.35,null],[5.16,44.59,null],[5.33,46.04,null],[5.56,47.99,null],[6.35,54.69,null],[7.14,61.35,null],[7.92,67.9,null],[8.74,74.76,null],[9.53,81.33,"STD"],[10.31,87.79,null],[11.13,94.55,null],[11.91,100.94,null],[12.7,107.39,"XS"],[14.27,120.11,null],[15.09,126.71,null],[15.88,133.03,null],[17.48,145.75,null],[19.05,158.1,null],[20.62,170.33,null],[22.23,182.75,null],[23.83,194.96,null],[25.4,206.83,null],[26.97,218.57,null],[27.79,224.65,null],[28.58,230.48,null],[31.75,253.56,null],[35.71,281.7,null],[50.8,381.83,null],[53.98,401.5,null],[55.88,413.01,null],[63.5,457.4,null]] },
  400: { od: 406.4, walls: [[4.19,41.56,null],[4.78,47.34,null],[5.16,51.06,null],[5.56,54.96,null],[6.35,62.64,null],[7.14,70.3,null],[7.92,77.83,null],[8.74,85.71,null],[9.53,93.27,"STD"],[10.31,100.7,null],[11.13,108.49,null],[11.91,115.86,null],[12.7,123.3,"XS"],[14.27,137.99,null],[15.88,152.93,null],[16.66,160.12,null],[17.48,167.65,null],[19.05,181.97,null],[20.62,196.16,null],[21.44,203.53,null],[22.23,210.6,null],[23.83,224.82,null],[25.4,238.64,null],[26.19,245.56,null],[26.97,252.35,null],[28.58,266.28,null],[30.18,280.0,null],[30.96,286.64,null],[31.75,293.33,null],[36.53,333.19,null],[40.49,365.35,null]] },
  450: { od: 457.0, walls: [[4.19,46.81,null],[4.78,53.31,null],[5.56,61.9,null],[6.35,70.57,null],[7.14,79.21,null],[7.92,87.71,null],[8.74,96.61,null],[9.53,105.16,"STD"],[10.31,113.57,null],[11.13,122.38,null],[11.91,130.72,null],[12.7,139.15,"XS"],[14.27,155.8,null],[15.88,172.74,null],[17.48,189.46,null],[19.05,205.74,null],[20.62,221.89,null],[22.23,238.34,null],[23.83,254.55,null],[25.4,270.34,null],[26.97,286.0,null],[28.58,301.94,null],[29.36,309.62,null],[30.18,317.66,null],[31.75,332.95,null],[34.93,363.56,null],[39.67,408.26,null],[45.24,459.37,null]] },
  500: { od: 508.0, walls: [[4.78,59.25,null],[5.56,68.89,null],[6.35,78.55,null],[7.14,88.19,null],[7.92,97.67,null],[8.74,107.6,null],[9.53,117.15,"STD"],[10.31,126.53,null],[11.13,136.37,null],[11.91,145.7,null],[12.7,155.12,"XS"],[14.27,173.74,null],[15.09,183.42,null],[15.88,192.71,null],[17.48,211.44,null],[19.05,229.7,null],[20.62,247.83,null],[22.23,266.29,null],[23.83,284.52,null],[25.4,302.28,null],[26.19,311.17,null],[26.97,319.92,null],[28.58,337.89,null],[30.18,355.61,null],[31.75,372.88,null],[32.54,381.53,null],[33.32,390.03,null],[34.93,407.49,null],[38.1,441.49,null],[44.45,508.11,null],[50.01,564.81,null]] },
  550: { od: 559.0, walls: [[4.78,65.24,null],[5.56,75.88,null],[6.35,86.54,null],[7.14,97.17,null],[7.92,107.63,null],[8.74,118.6,null],[9.53,129.13,"STD"],[10.31,139.5,null],[11.13,150.37,null],[11.91,160.68,null],[12.7,171.09,"XS"],[14.27,191.69,null],[15.88,212.69,null],[17.48,233.43,null],[19.05,253.65,null],[20.62,273.76,null],[22.23,294.25,null],[23.83,314.49,null],[25.4,334.23,null],[26.97,353.84,null],[28.58,373.83,null],[30.18,393.57,null],[31.75,412.81,null],[33.32,431.94,null],[34.93,451.42,null],[36.53,470.66,null],[38.1,489.41,null],[41.28,527.02,null],[47.63,600.63,null],[53.98,672.26,null]] },
  600: { od: 610.0, walls: [[5.54,82.47,null],[6.35,94.53,null],[7.14,106.15,null],[7.92,117.59,null],[8.74,129.59,null],[9.53,141.12,"STD"],[10.31,152.47,null],[11.13,164.37,null],[11.91,175.66,null],[12.7,187.06,"XS"],[14.27,209.64,null],[15.88,232.66,null],[17.48,255.41,null],[19.05,277.61,null],[20.62,299.69,null],[22.23,322.21,null],[23.83,344.46,null],[24.61,355.26,null],[25.4,366.17,null],[26.97,387.76,null],[28.58,409.77,null],[30.18,431.52,null],[30.96,442.08,null],[31.75,452.74,null],[33.32,473.84,null],[34.93,495.35,null],[36.53,516.8,null],[38.1,537.33,null],[38.89,547.71,null],[39.67,557.43,null],[46.02,640.03,null],[52.37,720.15,null],[59.54,808.22,null]] },
  650: { od: 660.0, walls: [[6.35,102.36,null],[7.14,114.95,null],[7.92,127.36,null],[8.74,140.37,null],[9.53,152.87,"STD"],[10.31,165.18,null],[11.13,178.09,null],[11.91,190.34,null],[12.7,202.72,"XS"],[14.27,227.23,null],[15.88,252.24,null],[17.48,276.96,null],[19.05,301.1,null],[20.62,325.12,null],[22.23,349.62,null],[23.83,373.84,null],[25.4,397.49,null]] },
  700: { od: 711.0, walls: [[6.35,110.34,null],[7.14,123.93,null],[7.92,137.32,null],[8.74,151.36,null],[9.53,164.85,"STD"],[10.31,178.15,null],[11.13,192.09,null],[11.91,205.32,null],[12.7,218.69,"XS"],[14.27,245.18,null],[15.88,271.21,null],[17.48,298.95,null],[19.05,325.06,null],[20.62,351.05,null],[22.23,377.58,null],[23.83,403.81,null],[25.4,429.44,null]] },
  750: { od: 762.0, walls: [[6.35,118.33,null],[7.14,132.91,null],[7.92,147.28,null],[8.74,162.35,null],[9.53,176.84,"STD"],[10.31,191.11,null],[11.13,206.09,null],[11.91,220.3,null],[12.7,234.67,"XS"],[14.27,263.12,null],[15.88,292.18,null],[17.48,320.93,null],[19.05,349.02,null],[20.62,376.98,null],[22.23,405.54,null],[23.83,433.78,null],[25.4,461.38,null],[26.97,488.85,null],[28.58,516.9,null],[30.18,544.65,null],[31.75,571.75,null]] },
  800: { od: 813.0, walls: [[6.35,126.31,null],[7.14,141.89,null],[7.92,157.24,null],[8.74,173.34,null],[9.53,188.82,"STD"],[10.31,204.08,null],[11.13,220.08,null],[11.91,235.28,null],[12.7,250.64,"XS"],[14.27,281.07,null],[15.88,312.15,null],[17.48,342.91,null],[19.05,372.98,null],[20.62,402.92,null],[22.23,433.49,null],[23.83,463.75,null],[25.4,493.32,null],[26.97,522.77,null],[28.58,552.85,null],[30.18,582.61,null],[31.75,611.68,null]] },
  850: { od: 864.0, walls: [[6.35,134.3,null],[7.14,150.87,null],[7.92,167.2,null],[8.74,184.33,null],[9.53,200.31,"STD"],[10.31,217.05,null],[11.13,234.08,null],[11.91,250.26,null],[12.7,266.61,"XS"],[14.27,299.02,null],[15.88,332.12,null],[17.48,364.9,null],[19.05,396.93,null],[20.62,428.85,null],[22.23,461.45,null],[23.83,493.72,null],[25.4,525.27,null],[26.97,556.69,null],[28.58,588.79,null],[30.18,620.56,null],[31.75,651.61,null]] },
  900: { od: 914.0, walls: [[6.35,142.13,null],[7.14,159.67,null],[7.92,176.96,null],[8.74,195.11,null],[9.53,212.56,"STD"],[10.31,229.76,null],[11.13,247.31,null],[11.91,264.94,null],[12.7,282.27,"XS"],[14.27,316.11,null],[15.88,351.7,null],[17.48,386.45,null],[19.05,420.42,null],[20.62,454.27,null],[22.23,488.86,null],[23.83,523.11,null],[25.4,556.59,null],[26.97,589.95,null],[28.58,624.03,null],[30.18,657.77,null],[31.75,690.76,null]] },
  950: { od: 965.0, walls: [[7.92,186.92,null],[8.74,206.1,null],[9.53,224.54,"STD"],[10.31,242.72,null],[11.13,261.8,null],[11.91,279.92,null],[12.7,298.24,"XS"],[14.27,334.56,null],[15.88,371.68,null],[17.48,408.43,null],[19.05,444.38,null],[20.62,480.21,null],[22.23,516.82,null],[23.83,553.08,null],[25.4,588.53,null],[26.97,623.87,null],[28.58,659.97,null],[30.18,695.73,null],[31.75,730.69,null]] },
  1000: { od: 1016.0, walls: [[7.92,196.89,null],[8.74,217.09,null],[9.53,236.53,"STD"],[10.31,255.69,null],[11.13,275.8,null],[11.91,294.9,null],[12.7,314.22,"XS"],[14.27,352.51,null],[15.88,391.65,null],[17.48,430.42,null],[19.05,468.34,null],[20.62,506.14,null],[22.23,544.78,null],[23.83,583.05,null],[25.4,620.48,null],[26.97,657.78,null],[28.58,695.92,null],[30.18,733.68,null],[31.75,770.62,null]] },
  1050: { od: 1067.0, walls: [[8.74,228.09,null],[9.53,248.52,"STD"],[10.31,268.66,null],[11.13,289.8,null],[11.91,309.88,null],[12.7,330.19,"XS"],[14.27,370.45,null],[15.88,411.62,null],[17.48,452.4,null],[19.05,492.3,null],[20.62,532.07,null],[22.23,572.73,null],[23.83,613.02,null],[25.4,652.42,null],[26.97,691.7,null],[28.58,731.86,null],[30.18,771.64,null],[31.75,810.55,null]] },
  1100: { od: 1118.0, walls: [[8.74,239.08,null],[9.53,260.5,"STD"],[10.31,281.62,null],[11.13,303.8,null],[11.91,324.8,null],[12.7,346.16,"XS"],[14.27,388.4,null],[15.88,431.59,null],[17.48,474.37,null],[19.05,516.26,null],[20.62,558.0,null],[22.23,600.69,null],[23.83,642.99,null],[25.4,684.37,null],[26.97,725.62,null],[28.58,767.8,null],[30.18,809.6,null],[31.75,850.48,null]] },
  1150: { od: 1168.0, walls: [[8.74,249.85,null],[9.53,272.25,"STD"],[10.31,294.34,null],[11.13,317.52,null],[11.91,339.54,null],[12.7,351.82,"XS"],[14.27,406.0,null],[15.88,451.17,null],[17.48,495.94,null],[19.05,539.76,null],[20.62,583.43,null],[22.23,628.1,null],[23.83,672.37,null],[25.4,715.68,null],[26.97,758.88,null],[28.58,803.04,null],[30.18,846.81,null],[31.75,889.63,null]] },
  1200: { od: 1219.0, walls: [[8.74,260.85,null],[9.53,284.24,"STD"],[10.31,307.3,null],[11.13,331.52,null],[11.91,354.52,null],[12.7,377.79,"XS"],[14.27,423.94,null],[15.88,471.14,null],[17.48,517.92,null],[19.05,563.7,null],[20.62,609.36,null],[22.23,656.06,null],[23.83,702.34,null],[25.4,747.63,null],[26.97,792.8,null],[28.58,838.99,null],[30.18,884.77,null],[31.75,929.56,null]] },
};

export const CAT_FLANGE: Record<number, Record<number, CatFlange>> = {
  150: {
    15: {"od":89.0,"thk":11.2,"rfDia":34.9,"holes":4,"boltCircle":60.3,"holeDia":15.8,"hubLen":48.0,"w":{"WN":0.6,"SO":0.8,"LAP":0.8,"THR":0.8,"BLIND":1.2}},
    20: {"od":99.0,"thk":12.7,"rfDia":42.9,"holes":4,"boltCircle":69.8,"holeDia":15.8,"hubLen":52.0,"w":{"WN":0.8,"SO":0.9,"LAP":0.9,"THR":0.9,"BLIND":1.3}},
    25: {"od":108.0,"thk":14.3,"rfDia":50.8,"holes":4,"boltCircle":79.4,"holeDia":15.8,"hubLen":56.0,"w":{"WN":1.1,"SO":1.0,"LAP":1.0,"THR":1.0,"BLIND":1.4}},
    32: {"od":117.0,"thk":15.7,"rfDia":63.5,"holes":4,"boltCircle":88.9,"holeDia":15.8,"hubLen":57.0,"w":{"WN":1.4,"SO":1.3,"LAP":1.3,"THR":1.3,"BLIND":1.8}},
    40: {"od":127.0,"thk":17.5,"rfDia":73.0,"holes":4,"boltCircle":98.4,"holeDia":15.8,"hubLen":62.0,"w":{"WN":1.8,"SO":1.5,"LAP":1.5,"THR":1.5,"BLIND":2.2}},
    50: {"od":152.0,"thk":19.1,"rfDia":92.1,"holes":4,"boltCircle":120.6,"holeDia":19.0,"hubLen":63.0,"w":{"WN":2.7,"SO":2.3,"LAP":2.3,"THR":2.3,"BLIND":2.8}},
    65: {"od":178.0,"thk":22.3,"rfDia":104.8,"holes":4,"boltCircle":139.7,"holeDia":19.0,"hubLen":70.0,"w":{"WN":4.0,"SO":3.7,"LAP":3.7,"THR":3.7,"BLIND":4.7}},
    80: {"od":190.0,"thk":23.9,"rfDia":127.0,"holes":4,"boltCircle":152.4,"holeDia":19.0,"hubLen":70.0,"w":{"WN":4.5,"SO":4.2,"LAP":4.2,"THR":4.2,"BLIND":5.5}},
    100: {"od":229.0,"thk":23.9,"rfDia":157.2,"holes":8,"boltCircle":190.5,"holeDia":19.0,"hubLen":76.0,"w":{"WN":7.0,"SO":5.9,"LAP":5.9,"THR":5.9,"BLIND":8.0}},
    125: {"od":254.0,"thk":23.9,"rfDia":185.7,"holes":8,"boltCircle":215.9,"holeDia":22.2,"hubLen":89.0,"w":{"WN":8.6,"SO":7.0,"LAP":7.0,"THR":7.0,"BLIND":9.0}},
    150: {"od":279.0,"thk":25.4,"rfDia":215.9,"holes":8,"boltCircle":241.3,"holeDia":22.2,"hubLen":89.0,"w":{"WN":10.8,"SO":8.5,"LAP":8.5,"THR":8.5,"BLIND":12.0}},
    200: {"od":343.0,"thk":28.5,"rfDia":269.9,"holes":8,"boltCircle":298.4,"holeDia":22.2,"hubLen":102.0,"w":{"WN":18.0,"SO":13.5,"LAP":13.5,"THR":13.5,"BLIND":20.0}},
    250: {"od":406.0,"thk":30.2,"rfDia":323.8,"holes":12,"boltCircle":362.0,"holeDia":25.4,"hubLen":102.0,"w":{"WN":24.0,"SO":19.5,"LAP":19.5,"THR":19.5,"BLIND":32.0}},
    300: {"od":483.0,"thk":31.8,"rfDia":381.0,"holes":12,"boltCircle":431.8,"holeDia":25.4,"hubLen":114.0,"w":{"WN":37.0,"SO":29.0,"LAP":29.0,"THR":29.0,"BLIND":40.0}},
    350: {"od":533.0,"thk":35.0,"rfDia":412.8,"holes":12,"boltCircle":476.2,"holeDia":28.5,"hubLen":127.0,"w":{"WN":47.0,"SO":39.0,"LAP":45.0,"THR":39.0,"BLIND":59.0}},
    400: {"od":597.0,"thk":36.6,"rfDia":469.9,"holes":16,"boltCircle":539.8,"holeDia":28.5,"hubLen":127.0,"w":{"WN":58.0,"SO":47.0,"LAP":58.0,"THR":47.0,"BLIND":77.0}},
    450: {"od":635.0,"thk":39.7,"rfDia":533.4,"holes":16,"boltCircle":577.8,"holeDia":31.8,"hubLen":140.0,"w":{"WN":64.0,"SO":54.0,"LAP":66.0,"THR":54.0,"BLIND":95.0}},
    500: {"od":698.0,"thk":42.9,"rfDia":584.2,"holes":20,"boltCircle":635.0,"holeDia":31.8,"hubLen":144.0,"w":{"WN":77.0,"SO":70.0,"LAP":84.0,"THR":70.0,"BLIND":123.0}},
    600: {"od":813.0,"thk":47.7,"rfDia":692.2,"holes":20,"boltCircle":749.3,"holeDia":35.0,"hubLen":152.0,"w":{"WN":118.0,"SO":95.0,"LAP":118.0,"THR":95.0,"BLIND":186.0}},
  },
  300: {
    15: {"od":95.0,"thk":14.2,"rfDia":34.9,"holes":4,"boltCircle":66.7,"holeDia":15.8,"hubLen":52.0,"w":{"WN":1.5,"SO":1.2,"LAP":1.2,"THR":1.2,"BLIND":1.5}},
    20: {"od":117.0,"thk":15.7,"rfDia":42.9,"holes":4,"boltCircle":82.6,"holeDia":19.0,"hubLen":57.0,"w":{"WN":1.8,"SO":1.3,"LAP":1.3,"THR":1.3,"BLIND":1.6}},
    25: {"od":124.0,"thk":17.5,"rfDia":50.8,"holes":4,"boltCircle":88.9,"holeDia":19.0,"hubLen":62.0,"w":{"WN":2.0,"SO":1.4,"LAP":1.4,"THR":1.4,"BLIND":2.0}},
    32: {"od":133.0,"thk":19.0,"rfDia":63.5,"holes":4,"boltCircle":98.4,"holeDia":19.0,"hubLen":65.0,"w":{"WN":2.5,"SO":1.8,"LAP":1.8,"THR":1.9,"BLIND":2.5}},
    40: {"od":156.0,"thk":20.6,"rfDia":73.0,"holes":4,"boltCircle":114.3,"holeDia":22.2,"hubLen":68.0,"w":{"WN":3.5,"SO":2.5,"LAP":2.5,"THR":2.8,"BLIND":3.0}},
    50: {"od":165.0,"thk":22.4,"rfDia":92.1,"holes":8,"boltCircle":127.0,"holeDia":19.0,"hubLen":70.0,"w":{"WN":4.0,"SO":3.0,"LAP":3.0,"THR":3.3,"BLIND":3.5}},
    65: {"od":190.0,"thk":25.4,"rfDia":104.8,"holes":8,"boltCircle":149.2,"holeDia":22.2,"hubLen":76.0,"w":{"WN":5.0,"SO":4.5,"LAP":4.5,"THR":4.6,"BLIND":5.5}},
    80: {"od":210.0,"thk":28.4,"rfDia":127.0,"holes":8,"boltCircle":168.3,"holeDia":22.2,"hubLen":79.0,"w":{"WN":7.0,"SO":6.0,"LAP":6.0,"THR":6.3,"BLIND":7.0}},
    100: {"od":254.0,"thk":31.8,"rfDia":157.2,"holes":8,"boltCircle":200.0,"holeDia":22.2,"hubLen":86.0,"w":{"WN":11.0,"SO":10.1,"LAP":10.1,"THR":10.2,"BLIND":12.0}},
    125: {"od":279.0,"thk":35.0,"rfDia":185.7,"holes":8,"boltCircle":235.0,"holeDia":22.2,"hubLen":98.0,"w":{"WN":14.0,"SO":12.5,"LAP":12.5,"THR":12.9,"BLIND":15.8}},
    150: {"od":318.0,"thk":36.6,"rfDia":215.9,"holes":12,"boltCircle":269.9,"holeDia":22.2,"hubLen":98.0,"w":{"WN":19.0,"SO":17.5,"LAP":17.5,"THR":18.0,"BLIND":23.0}},
    200: {"od":381.0,"thk":41.1,"rfDia":269.9,"holes":12,"boltCircle":330.2,"holeDia":25.4,"hubLen":111.0,"w":{"WN":30.0,"SO":26.0,"LAP":26.0,"THR":26.0,"BLIND":37.0}},
    250: {"od":444.0,"thk":47.8,"rfDia":323.8,"holes":16,"boltCircle":387.4,"holeDia":28.5,"hubLen":117.0,"w":{"WN":41.0,"SO":38.0,"LAP":41.0,"THR":38.0,"BLIND":58.0}},
    300: {"od":521.0,"thk":50.8,"rfDia":381.0,"holes":16,"boltCircle":450.8,"holeDia":31.8,"hubLen":130.0,"w":{"WN":62.0,"SO":52.0,"LAP":63.0,"THR":52.0,"BLIND":83.0}},
    350: {"od":584.0,"thk":53.8,"rfDia":412.8,"holes":20,"boltCircle":514.4,"holeDia":31.8,"hubLen":143.0,"w":{"WN":84.0,"SO":74.0,"LAP":86.0,"THR":74.0,"BLIND":107.0}},
    400: {"od":648.0,"thk":57.2,"rfDia":469.9,"holes":20,"boltCircle":571.5,"holeDia":35.0,"hubLen":146.0,"w":{"WN":111.0,"SO":100.0,"LAP":109.0,"THR":100.0,"BLIND":139.0}},
    450: {"od":711.0,"thk":60.5,"rfDia":533.4,"holes":24,"boltCircle":628.6,"holeDia":35.0,"hubLen":159.0,"w":{"WN":138.0,"SO":127.0,"LAP":138.0,"THR":127.0,"BLIND":177.0}},
    500: {"od":775.0,"thk":63.5,"rfDia":584.2,"holes":24,"boltCircle":685.8,"holeDia":35.0,"hubLen":162.0,"w":{"WN":171.0,"SO":147.0,"LAP":170.0,"THR":147.0,"BLIND":223.0}},
    600: {"od":914.0,"thk":69.9,"rfDia":692.2,"holes":24,"boltCircle":812.8,"holeDia":41.1,"hubLen":168.0,"w":{"WN":247.0,"SO":208.0,"LAP":241.0,"THR":213.0,"BLIND":342.0}},
  },
  400: {
    100: {"od":254.0,"thk":35.0,"rfDia":157.2,"holes":8,"boltCircle":200.1,"holeDia":25.4,"hubLen":89.0,"w":{"WN":16.0,"SO":13.0,"LAP":13.0,"THR":15.0,"BLIND":15.0}},
    125: {"od":279.0,"thk":38.1,"rfDia":185.7,"holes":8,"boltCircle":235.0,"holeDia":25.4,"hubLen":102.0,"w":{"WN":19.0,"SO":18.5,"LAP":18.5,"THR":20.0,"BLIND":21.0}},
    150: {"od":318.0,"thk":41.1,"rfDia":215.9,"holes":12,"boltCircle":269.9,"holeDia":25.4,"hubLen":103.0,"w":{"WN":26.0,"SO":25.0,"LAP":25.0,"THR":28.0,"BLIND":28.0}},
    200: {"od":381.0,"thk":47.8,"rfDia":269.9,"holes":12,"boltCircle":330.2,"holeDia":28.5,"hubLen":117.0,"w":{"WN":40.0,"SO":34.0,"LAP":34.0,"THR":37.0,"BLIND":43.0}},
    250: {"od":444.0,"thk":53.8,"rfDia":323.8,"holes":16,"boltCircle":387.4,"holeDia":31.8,"hubLen":124.0,"w":{"WN":57.0,"SO":54.0,"LAP":51.0,"THR":60.0,"BLIND":65.0}},
    300: {"od":521.0,"thk":57.2,"rfDia":381.0,"holes":16,"boltCircle":450.8,"holeDia":35.0,"hubLen":137.0,"w":{"WN":80.0,"SO":70.0,"LAP":69.0,"THR":76.0,"BLIND":95.0}},
    350: {"od":584.0,"thk":60.5,"rfDia":412.8,"holes":20,"boltCircle":514.4,"holeDia":35.0,"hubLen":149.0,"w":{"WN":105.0,"SO":85.0,"LAP":95.0,"THR":93.0,"BLIND":126.0}},
    400: {"od":648.0,"thk":63.5,"rfDia":469.9,"holes":20,"boltCircle":571.5,"holeDia":38.1,"hubLen":152.0,"w":{"WN":131.0,"SO":120.0,"LAP":127.0,"THR":132.0,"BLIND":163.0}},
    450: {"od":711.0,"thk":66.5,"rfDia":533.4,"holes":24,"boltCircle":628.6,"holeDia":38.1,"hubLen":165.0,"w":{"WN":159.0,"SO":150.0,"LAP":157.0,"THR":165.0,"BLIND":206.0}},
    500: {"od":775.0,"thk":69.9,"rfDia":584.2,"holes":24,"boltCircle":685.8,"holeDia":41.1,"hubLen":168.0,"w":{"WN":190.0,"SO":185.0,"LAP":191.0,"THR":205.0,"BLIND":256.0}},
    600: {"od":914.0,"thk":76.2,"rfDia":692.2,"holes":24,"boltCircle":812.8,"holeDia":47.8,"hubLen":175.0,"w":{"WN":275.0,"SO":260.0,"LAP":279.0,"THR":285.0,"BLIND":387.0}},
  },
  600: {
    15: {"od":95.0,"thk":14.2,"rfDia":34.9,"holes":4,"boltCircle":66.7,"holeDia":15.8,"hubLen":52.0,"w":{"WN":1.5,"SO":1.3,"LAP":1.3,"THR":1.4,"BLIND":1.4}},
    20: {"od":117.0,"thk":15.7,"rfDia":42.9,"holes":4,"boltCircle":82.6,"holeDia":19.0,"hubLen":57.0,"w":{"WN":2.0,"SO":1.4,"LAP":1.4,"THR":1.6,"BLIND":1.6}},
    25: {"od":124.0,"thk":17.5,"rfDia":50.8,"holes":4,"boltCircle":88.9,"holeDia":19.0,"hubLen":62.0,"w":{"WN":2.5,"SO":1.8,"LAP":1.8,"THR":2.1,"BLIND":2.1}},
    32: {"od":133.0,"thk":20.6,"rfDia":63.5,"holes":4,"boltCircle":98.4,"holeDia":19.0,"hubLen":67.0,"w":{"WN":3.2,"SO":2.1,"LAP":2.1,"THR":2.6,"BLIND":2.6}},
    40: {"od":156.0,"thk":22.4,"rfDia":73.0,"holes":4,"boltCircle":114.3,"holeDia":22.2,"hubLen":70.0,"w":{"WN":4.5,"SO":3.1,"LAP":3.1,"THR":3.3,"BLIND":3.3}},
    50: {"od":165.0,"thk":25.4,"rfDia":92.1,"holes":8,"boltCircle":127.0,"holeDia":19.0,"hubLen":73.0,"w":{"WN":5.5,"SO":4.0,"LAP":4.0,"THR":4.4,"BLIND":4.4}},
    65: {"od":190.0,"thk":28.4,"rfDia":104.8,"holes":8,"boltCircle":149.2,"holeDia":22.2,"hubLen":79.0,"w":{"WN":8.0,"SO":5.4,"LAP":5.4,"THR":6.0,"BLIND":6.0}},
    80: {"od":210.0,"thk":31.8,"rfDia":127.0,"holes":8,"boltCircle":168.3,"holeDia":22.2,"hubLen":83.0,"w":{"WN":10.5,"SO":7.0,"LAP":7.0,"THR":7.4,"BLIND":7.4}},
    100: {"od":273.0,"thk":38.1,"rfDia":157.2,"holes":8,"boltCircle":215.9,"holeDia":25.4,"hubLen":102.0,"w":{"WN":19.0,"SO":16.0,"LAP":16.0,"THR":17.0,"BLIND":17.0}},
    125: {"od":330.0,"thk":44.5,"rfDia":185.7,"holes":8,"boltCircle":266.7,"holeDia":28.5,"hubLen":114.0,"w":{"WN":31.0,"SO":25.0,"LAP":25.0,"THR":27.0,"BLIND":27.0}},
    150: {"od":356.0,"thk":47.8,"rfDia":215.9,"holes":12,"boltCircle":292.1,"holeDia":28.5,"hubLen":117.0,"w":{"WN":37.0,"SO":30.0,"LAP":30.0,"THR":32.0,"BLIND":32.0}},
    200: {"od":419.0,"thk":55.6,"rfDia":269.9,"holes":12,"boltCircle":349.2,"holeDia":31.8,"hubLen":133.0,"w":{"WN":53.0,"SO":43.0,"LAP":43.0,"THR":46.0,"BLIND":46.0}},
    250: {"od":508.0,"thk":63.5,"rfDia":323.8,"holes":16,"boltCircle":431.8,"holeDia":35.0,"hubLen":152.0,"w":{"WN":86.0,"SO":70.0,"LAP":89.0,"THR":74.0,"BLIND":74.0}},
    300: {"od":559.0,"thk":66.5,"rfDia":381.0,"holes":20,"boltCircle":489.0,"holeDia":35.0,"hubLen":156.0,"w":{"WN":102.0,"SO":86.0,"LAP":109.0,"THR":90.0,"BLIND":90.0}},
    350: {"od":603.0,"thk":69.9,"rfDia":412.8,"holes":20,"boltCircle":527.0,"holeDia":38.1,"hubLen":165.0,"w":{"WN":150.0,"SO":100.0,"LAP":132.0,"THR":108.0,"BLIND":108.0}},
    400: {"od":686.0,"thk":76.2,"rfDia":469.9,"holes":20,"boltCircle":603.2,"holeDia":41.1,"hubLen":178.0,"w":{"WN":190.0,"SO":142.0,"LAP":182.0,"THR":150.0,"BLIND":150.0}},
    450: {"od":743.0,"thk":82.6,"rfDia":533.4,"holes":20,"boltCircle":654.0,"holeDia":44.5,"hubLen":184.0,"w":{"WN":240.0,"SO":175.0,"LAP":213.0,"THR":188.0,"BLIND":188.0}},
    500: {"od":813.0,"thk":88.9,"rfDia":584.2,"holes":24,"boltCircle":723.9,"holeDia":44.5,"hubLen":190.0,"w":{"WN":295.0,"SO":221.0,"LAP":274.0,"THR":230.0,"BLIND":230.0}},
    600: {"od":940.0,"thk":101.6,"rfDia":692.2,"holes":24,"boltCircle":838.2,"holeDia":50.8,"hubLen":203.0,"w":{"WN":365.0,"SO":315.0,"LAP":393.0,"THR":325.0,"BLIND":325.0}},
  },
  900: {
    80: {"od":241.0,"thk":38.1,"rfDia":127.0,"holes":8,"boltCircle":190.5,"holeDia":25.4,"hubLen":102.0,"w":{"WN":14.5,"SO":11.6,"LAP":11.6,"THR":11.9,"BLIND":14.5}},
    100: {"od":292.0,"thk":44.5,"rfDia":157.2,"holes":8,"boltCircle":235.0,"holeDia":31.8,"hubLen":114.0,"w":{"WN":23.0,"SO":19.8,"LAP":19.8,"THR":20.0,"BLIND":24.0}},
    125: {"od":349.0,"thk":50.8,"rfDia":185.7,"holes":8,"boltCircle":279.4,"holeDia":35.0,"hubLen":127.0,"w":{"WN":37.0,"SO":32.0,"LAP":32.0,"THR":33.0,"BLIND":39.0}},
    150: {"od":381.0,"thk":55.6,"rfDia":215.9,"holes":12,"boltCircle":317.5,"holeDia":31.8,"hubLen":140.0,"w":{"WN":50.0,"SO":41.0,"LAP":41.0,"THR":42.0,"BLIND":51.0}},
    200: {"od":470.0,"thk":63.5,"rfDia":269.9,"holes":12,"boltCircle":393.7,"holeDia":38.1,"hubLen":162.0,"w":{"WN":85.0,"SO":71.0,"LAP":85.0,"THR":72.0,"BLIND":89.0}},
    250: {"od":546.0,"thk":69.9,"rfDia":323.8,"holes":16,"boltCircle":469.9,"holeDia":38.1,"hubLen":184.0,"w":{"WN":118.0,"SO":100.0,"LAP":126.0,"THR":101.0,"BLIND":130.0}},
    300: {"od":610.0,"thk":79.2,"rfDia":381.0,"holes":20,"boltCircle":533.4,"holeDia":38.1,"hubLen":200.0,"w":{"WN":163.0,"SO":133.0,"LAP":168.0,"THR":134.0,"BLIND":175.0}},
    350: {"od":641.0,"thk":85.9,"rfDia":412.8,"holes":20,"boltCircle":558.8,"holeDia":41.1,"hubLen":213.0,"w":{"WN":186.0,"SO":152.0,"LAP":180.0,"THR":154.0,"BLIND":206.0}},
    400: {"od":705.0,"thk":88.9,"rfDia":469.9,"holes":20,"boltCircle":616.0,"holeDia":44.5,"hubLen":216.0,"w":{"WN":224.0,"SO":184.0,"LAP":222.0,"THR":186.0,"BLIND":259.0}},
    450: {"od":787.0,"thk":101.6,"rfDia":533.4,"holes":20,"boltCircle":685.8,"holeDia":50.8,"hubLen":229.0,"w":{"WN":300.0,"SO":258.0,"LAP":304.0,"THR":260.0,"BLIND":367.0}},
    500: {"od":857.0,"thk":108.0,"rfDia":584.2,"holes":20,"boltCircle":749.3,"holeDia":53.8,"hubLen":248.0,"w":{"WN":373.0,"SO":317.0,"LAP":394.0,"THR":320.0,"BLIND":463.0}},
    600: {"od":1041.0,"thk":139.7,"rfDia":692.2,"holes":20,"boltCircle":901.7,"holeDia":66.5,"hubLen":292.0,"w":{"WN":680.0,"SO":608.0,"LAP":753.0,"THR":611.0,"BLIND":875.0}},
  },
  1500: {
    15: {"od":121.0,"thk":22.4,"rfDia":34.9,"holes":4,"boltCircle":82.6,"holeDia":22.2,"hubLen":60.0,"w":{"WN":2.0}},
    20: {"od":130.0,"thk":25.4,"rfDia":42.9,"holes":4,"boltCircle":88.9,"holeDia":22.2,"hubLen":70.0,"w":{"WN":3.0}},
    25: {"od":149.0,"thk":28.4,"rfDia":50.8,"holes":4,"boltCircle":101.6,"holeDia":25.4,"hubLen":73.0,"w":{"WN":4.0}},
    32: {"od":159.0,"thk":28.4,"rfDia":63.5,"holes":4,"boltCircle":111.1,"holeDia":25.4,"hubLen":73.0,"w":{"WN":4.6}},
    40: {"od":178.0,"thk":31.8,"rfDia":73.0,"holes":4,"boltCircle":123.8,"holeDia":28.5,"hubLen":83.0,"w":{"WN":6.5}},
    50: {"od":216.0,"thk":38.1,"rfDia":92.1,"holes":8,"boltCircle":165.1,"holeDia":25.4,"hubLen":102.0,"w":{"WN":11.5}},
    65: {"od":244.0,"thk":41.1,"rfDia":104.8,"holes":8,"boltCircle":190.5,"holeDia":28.5,"hubLen":105.0,"w":{"WN":15.8}},
    80: {"od":267.0,"thk":47.8,"rfDia":127.0,"holes":8,"boltCircle":203.2,"holeDia":31.8,"hubLen":118.0,"w":{"WN":22.0}},
    100: {"od":311.0,"thk":53.8,"rfDia":157.2,"holes":8,"boltCircle":241.3,"holeDia":35.0,"hubLen":124.0,"w":{"WN":30.0}},
    125: {"od":375.0,"thk":73.2,"rfDia":185.7,"holes":8,"boltCircle":292.1,"holeDia":41.1,"hubLen":155.0,"w":{"WN":58.0}},
    150: {"od":394.0,"thk":82.6,"rfDia":215.9,"holes":12,"boltCircle":317.5,"holeDia":38.1,"hubLen":171.0,"w":{"WN":70.0}},
    200: {"od":483.0,"thk":91.9,"rfDia":269.7,"holes":12,"boltCircle":393.7,"holeDia":44.5,"hubLen":213.0,"w":{"WN":119.0}},
    250: {"od":584.0,"thk":108.0,"rfDia":323.8,"holes":12,"boltCircle":482.6,"holeDia":50.8,"hubLen":254.0,"w":{"WN":204.0}},
    300: {"od":673.0,"thk":124.0,"rfDia":381.0,"holes":16,"boltCircle":571.5,"holeDia":53.8,"hubLen":283.0,"w":{"WN":303.0}},
    350: {"od":749.0,"thk":133.4,"rfDia":412.8,"holes":16,"boltCircle":635.0,"holeDia":60.5,"hubLen":298.0,"w":{"WN":426.0}},
    400: {"od":826.0,"thk":146.0,"rfDia":469.9,"holes":16,"boltCircle":704.8,"holeDia":66.5,"hubLen":311.0,"w":{"WN":567.0}},
    450: {"od":914.0,"thk":162.0,"rfDia":533.4,"holes":16,"boltCircle":774.7,"holeDia":73.2,"hubLen":327.0,"w":{"WN":737.0}},
    500: {"od":984.0,"thk":177.8,"rfDia":584.2,"holes":16,"boltCircle":831.8,"holeDia":79.2,"hubLen":356.0,"w":{"WN":930.0}},
    600: {"od":1168.0,"thk":203.2,"rfDia":692.2,"holes":null,"boltCircle":null,"holeDia":null,"hubLen":406.0,"w":{"WN":1510.0}},
  },
  2500: {
    15: {"od":133.0,"thk":30.2,"rfDia":34.9,"holes":4,"boltCircle":88.9,"holeDia":22.2,"hubLen":73.0,"w":{"WN":3.6}},
    20: {"od":140.0,"thk":31.8,"rfDia":42.9,"holes":4,"boltCircle":95.3,"holeDia":22.2,"hubLen":79.0,"w":{"WN":4.0}},
    25: {"od":159.0,"thk":35.0,"rfDia":50.8,"holes":4,"boltCircle":108.0,"holeDia":25.4,"hubLen":89.0,"w":{"WN":6.0}},
    32: {"od":184.0,"thk":38.1,"rfDia":63.5,"holes":4,"boltCircle":130.0,"holeDia":28.5,"hubLen":95.0,"w":{"WN":9.0}},
    40: {"od":203.0,"thk":44.5,"rfDia":73.0,"holes":4,"boltCircle":146.0,"holeDia":31.8,"hubLen":111.0,"w":{"WN":13.0}},
    50: {"od":235.0,"thk":50.8,"rfDia":92.1,"holes":8,"boltCircle":171.5,"holeDia":28.5,"hubLen":127.0,"w":{"WN":19.0}},
    65: {"od":267.0,"thk":57.2,"rfDia":104.8,"holes":8,"boltCircle":196.9,"holeDia":31.8,"hubLen":143.0,"w":{"WN":24.0}},
    80: {"od":305.0,"thk":66.5,"rfDia":127.0,"holes":8,"boltCircle":228.6,"holeDia":35.0,"hubLen":168.0,"w":{"WN":43.0}},
    100: {"od":356.0,"thk":76.2,"rfDia":157.2,"holes":8,"boltCircle":273.0,"holeDia":41.1,"hubLen":190.0,"w":{"WN":66.0}},
    125: {"od":419.0,"thk":91.9,"rfDia":185.7,"holes":8,"boltCircle":323.9,"holeDia":47.8,"hubLen":229.0,"w":{"WN":111.0}},
    150: {"od":483.0,"thk":108.0,"rfDia":215.9,"holes":8,"boltCircle":368.3,"holeDia":53.8,"hubLen":273.0,"w":{"WN":172.0}},
    200: {"od":552.0,"thk":127.0,"rfDia":269.9,"holes":12,"boltCircle":438.2,"holeDia":53.8,"hubLen":317.0,"w":{"WN":261.0}},
    250: {"od":673.0,"thk":165.1,"rfDia":323.8,"holes":12,"boltCircle":539.8,"holeDia":66.5,"hubLen":419.0,"w":{"WN":485.0}},
    300: {"od":762.0,"thk":184.2,"rfDia":381.0,"holes":12,"boltCircle":619.3,"holeDia":73.2,"hubLen":464.0,"w":{"WN":730.0}},
  },
};

/** DN sizes that have a flange in the catalogue, ascending. */
export const CAT_DNS: number[] = Object.keys(CAT_FLANGE[150]).map(Number).sort((a, b) => a - b);
