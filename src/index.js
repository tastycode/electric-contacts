//import stateGeos from "./gz_2010_us_040_00_500k.json";
const {Point2D, Intersection, Shapes} = require("kld-intersections");
import "./styles.css";
import geojsonExtent from "@mapbox/geojson-extent";
import mapboxgl from 'mapbox-gl'
import { SVG } from '@svgdotjs/svg.js'
import { throttle } from "utils-decorators";
import * as turf from '@turf/turf'
import chroma from 'chroma-js'
import { geoFromSVGXML } from 'svg2geojson'
import * as R from 'ramda'
import UnitedStates from 'states-us'
import { collapseTextChangeRangesAcrossMultipleVersions } from "typescript";
var pdfjsLib = require("pdfjs-dist");
const toBBox = require("geojson-bounding-box");

let progressState = ''
let progressDetail = null;

class RuntimeContext {

  features = {
    container: {
      svgPath: null,
      geo: {
        box: null,
        bounds: null,
        points: null,
      },
      screen: {
        box: null,
        bounds: null,
        points: null,
      },
      view: {
        box: null,
        bounds: null,
        points: null,
      }
    },
    state: {
      svgPath: null,
      geo: {
        box: null,
        bounds: null,
        points: null,
      },
      screen: {
        box: null,
        bounds: null,
        points: null,
      },
      view: {
        box: null,
        bounds: null,
        points: null,
      }
    }
  }
  transformers = {
    sXg: null,
    vXs: null
  } 
  refs = {
    $mc: null
  }
  data = {
    states: [],
    selectedState: null,
    districts: [],
    selectedDistrict: null
  }
  

  @throttle(100)
  showProgress(title, detail) {
    const d1 = document.querySelector('#progress-title');
    if (!R.isNil(d1))
      d1.innerText = title
    const d2 = document.querySelector('#progress-detail');
    if (!R.isNil(d2))
      d2.innerText = R.isNil(detail) ? '' : detail;
    console.log('Progress: ', title, detail)
  }
}

const runtime = new RuntimeContext()
const stateFeature = runtime.features.state
const containerFeature = runtime.features.container
window.runtime = runtime

const updateStyles = (changes = {
  opacity: 0.5
}) => {
  document.querySelector('#map-overlay').style.opacity = opacity
  document.querySelector('#map-interactive-overlay').style.opacity = opacity + 0.25
  

}


// obviously, there are other ways to do this
// in the absence of a known deployment environment
// this is enough for me to use my own token
let mbT = 'pk.eyJ1IjoidGF'
mbT = `${mbT}zdHljb2RlMiI`
mbT = `${mbT}sImEiOiJjbGd`
mbT = `${mbT}iNHdnOGEwb28`
mbT = `${mbT}wM2pxcDB6amt`
mbT = `${mbT}rN3kwIn0.zuX`
mbT = `${mbT}HfjoFOj73cV_`
mbT = `${mbT}ni3t3UA`

progressState = ''
progressDetail = ''
runtime.showProgress('initializing')
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry.js");
document.getElementById("app").innerHTML = `
<h1>REC District Contact Filter</h1>
<p>
The PDF files for this tool are available at <a href="https://www.cooperative.com/programs-services/government-relations/Pages/Congressional-District-Maps.aspx" target="_blank">cooperative.com</a>.
</p>
<div>

<form>
<p>
  <label for="pdfDocument">PDF Map</label><br/>
  <input type="file" name="pdfDocument" id="pdfDocument" required accept="application/pdf, application/x-pdf"/>
</p>
<p>

  <label for="csvDocument">Contacts CSV</label><br/>
  <input type="file" name="contactDocument" id="contactDocument" accept="text/csv"/>

</p>
<p>
    <label for="state-list">Target State</label><br/>
      <select id="state-list"></select>
</p>
  <input type="submit">

  </p>
  
  <p class="coop-choice">
    <label for="coop-list">Cooperative</label><br/>
      <select id="coop-list" disabled>
        <option>No Data</option>
      </select>
  </p>
  
  
  <canvas id="pdf-canvas"></canvas>
  <div class="maps-container">
      <svg id="svg-context"></svg>
      <div class="overlays-container">
        <img id="map-overlay"/>
        <div id="map-interactive-overlay"/></div>
      </div>
  </div>
  </form>
  <fw-toast-message
  type="inprogress"
  id="progress-toast"
  sticky
  show
>
  <div
    style="display: flex;
    flex-direction: column;
    gap: 4px;"
  >
    <span
    id='progress-title'
      style="font-style: normal;
    font-weight: 700;
    font-size: 14px;
    line-height: 20px;
    color: #12344D;"
      >Initializing</span
    >
    <span
      id='progress-detail'
      style="font-style: normal;
    font-weight: normal;
    font-size: 11px;
    line-height: 18px;
    color: #12344D;"
      >Loading dependencies</span
    >
  </div>
</fw-toast-message>
  <div class="metadata">
    <div class="contacts-container">
        <svg id="svg-contacts"></svg>
    </div>
    <div id='candidate-zips-contained'>
    </div>
    <div id='candidate-zips-crossed'>
    </div>
    <div id='candidate-zips-errored'>
    </div>
  </div>
</div>
`;

let zipProperties = {}
let stateZips = {}
let stateGeos = { features: [] };
let states = [];


const getCenterOfBox = (bbox) => {
  return {
    x: bbox.x + (bbox.width / 2),
    y: bbox.y + (bbox.height / 2)
  }
}

const isPointWithinBox = (point, box) => {
  const boxMaxX = box.x + box.width
  const boxMaxY = box.y + box.height
  return point.x > box.x && point.y > box.y && point.x < boxMaxX && point.y < boxMaxY
}
const pointsForBox = ({x,y,width,height}) => {
  /* this function is presuming a relationship beteen x, and width, as well as height. 
   * x+width is not necessarily the top right
   * y + height . I know it stinks, sorry to whoever wrote this. */
  return [
    {
      x,
      y
    },
    {
      x: x + width,
      y
    },
    {
      x: x+width,
      y: y-height
    },
    {
      x,
      y: y - height
    }
  ]
}

const pointRelativeTo = ({x: xA, y: yA}, {x: xB,y: yB}) => {
  return {
    x: xA - xB,
    y: yA - yB,
  }
}

const boundsRelativeTo = ({x: xA, y: yA, width, height}, {x: xB, y: yB}) => {
  return {
    ...pointRelativeTo({x: xA, y: yA}, {x: xB, y: yB}) ,
    width,
    height
  }
}

const zeroOrigin = ({x,y,width,height}) => {
  return {
    x: 0,
    y: 0,
    width,
    height
  }
}

class SimpleShapeReferenceConverter {
  constructor(sourceBox, targetBox, options = {}) {
    if (R.isNil(sourceBox))
      throw new Error('Source cannot be null')
    if (R.isNil(targetBox))
      throw new Error('Target cannot be null')
    this.sourceBox = sourceBox
    this.targetBox = targetBox
    this.options = options
  }

  _transformer(source,target) {
    const sX = target.width / source.width
    const sY = target.height / source.height
    const tX = target.x - (source.x * sX)
    const tY = target.y +  (source.y * sY)
    return {
      sX, sY, tX, tY
    }
  }

  _targetTransformer() { 
    const { targetBox, sourceBox } = this
    return this._transformer(sourceBox, targetBox)
  }

  _sourceTransformer() {
    const { sourceBox, targetBox } = this
    return this._transformer(targetBox, sourceBox)
  }

  sourceToTarget({x,y}) {
    const {
      sX, sY, tX, tY
    } = this._targetTransformer()
    if (this.options.invertY) {
      return {
        x: x * sX + tX,
        y: (y * -sY + tY) - this.sourceBox.height,
      }
    } else {
      return {
        x: x * sX + tX,
        y: tY - y * sY,
      }
    }
  }

  targetToSource({x,y}) {
    const {
      sX, sY, tX, tY
    } = this._sourceTransformer()
    return {
      x: x * sX + tX,
      y: y * sY + tY
    }
  }

  targetToSourceBounds({x,y,width,height}) {
    const {
      sX, sY, tX, tY
    } = this._sourceTransformer()
    return {
      x: x * sX + tX,
      y: y * sY + tY,
      width: width * sX,
      height: height * sY
    }
  }
  sourceToTargetBounds({x,y,width,height}, {xOffset = 0, yOffset = 0} = {xOffset: 0, yOffset: 0 }) {
    const {
      sX, sY, tX, tY
    } = this._targetTransformer()
    if (this.options.invertY) {
      return {
        x: x * sX + tX,
        y: y * sY - tY,
        width: width * sX,
        height: height * sY
      }
    } else {
      return {
        x: x * sX + tX,
        y: y * sY + tY,
        width: width * sX + xOffset,
        height: height * sY + yOffset
      }
    }
  }
}
(async () => {
  stateGeos = await (
    await fetch(
      "https://uploads.codesandbox.io/uploads/user/08efd83b-7032-4e4f-a63c-f22884438c67/vThS-gz_2010_us_040_00_500k.json"
    )
  ).json();
  let stateOptions = "";
  states = stateGeos.features.map((f) => f.properties.NAME).sort();
  for (const state of states) {
    stateOptions += `<option>${state}</option>`;
  }
  document.querySelector("#state-list").innerHTML = stateOptions;
})();
(async () => {
  const {zip_state_county: countiesData} = await (
    await fetch(
      "/us-zcta-counties/zip_state_county.json"
    )
  ).json();

  stateZips = {}
  zipProperties = countiesData.reduce( (result, [zip, stateAbbreviation, zipName]) => {
    result[zip] = { zipName, stateAbbreviation }
    stateZips[stateAbbreviation] = {
      zip,
      name: zipName
    }
    return result
  },{})
})();

const fetchStateZipGeos = async (state) => {
  const path = `${state.abbreviation.toLowerCase()}_geo.min.json`
  const stateZip = await (await fetch(`/state-zip-geojson/${path}`)).json()
  return stateZip
}


const readAsText = (inputNode) => {
  var reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.addEventListener("load", (e) => {
      const text = reader.result
      resolve(reader.result)
    })
    reader.addEventListener("error", reject)
    if (inputNode.files[0]) {
      reader.readAsText(inputNode.files[0]);
    } else {
      resolve("")
    }
  });

}
const readAsBytes = (inputNode) => {
  var reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.addEventListener("load", () => {
      const arrayBuffer = reader.result;
      const array = new Uint8Array(arrayBuffer);
      resolve(array);
      //binaryString = String.fromCharCode.apply(null, array);
    })

    reader.addEventListener("error", reject)
    reader.readAsArrayBuffer(inputNode.files[0]);
  });
};

class SVGGraphicsOverride extends pdfjsLib.SVGGraphics {
  constructor(commonObjs, objs) {
    super(commonObjs, objs);
    this._currentSvgText = "";
  }
  beginText() {
    this._currentSvgText = "";
    super.beginText()
  }

  showText = (glyphs) => {
    let localStr = ""
    for (const glyph of glyphs) {
      if (glyph && glyph.unicode !== undefined) {
        this._currentSvgText += glyph.unicode;
        localStr += glyph.unicode

      }
    }
    if (localStr) 
       this.current.tspan.ariaLabel =  localStr
    if (this._currentSvgText) 
      this.current.txtElement.ariaLabel = (this.current.txtElement.ariaLabel ?? "") + this._currentSvgText
    super.showText(glyphs);
  };
  endText = () => {
    super.endText();
    const svgText = this._currentSvgText;
    
    this._currentSvgText = "";
    // this extracts the original textnode name of the polyline and preserves
    // it so we can read it as a normal string, otherwise
    // the pdf stores a mapping of glyphs and optimizes it so that the 
    // mapping of shape to character is completely lost, reading the string is
    // fruitless
    //this.current.txtElement.setAttribute("aria-label", svgText);
  };
}
document
  .querySelector("input[type=file]")
  .addEventListener("change", async (e) => {
    const filename = e.target.files[0].name;
    if (e.target.name == 'pdfDocument') {
      const candidateState = states.find((state) => filename.includes(state));
      if (candidateState) {
        document.querySelector("select").value = candidateState;
      }

    }
  });
document
  .querySelector("form")
  .addEventListener("submit", async (e) => {
    e.preventDefault()


    // todo: all these share too much state, refactor

    let statePath, svg,  geoPaths, csvText, mbMap, coops, svgRoot,  zipGeos, stateGeo, baseWidth, targetHeight

    const parser = new DOMParser();
    coops = []
    runtime.refs.$mc = document.querySelector('.maps-container')


    const findStatePath = () => {
      // iterate over svg:path elements, calling `getBoundingClientRect` on each
      // the state path is the largest of them , or more precisely
      // is the path whose distance to the root svg bounding box is minimized
      const paths = [...svgRoot.querySelectorAll("path")];
      const sortedPaths = paths
        .map((p) => ({
          path: p,
          dimensions: pathDimensions(p)
        }))
        .sort((a, b) => {
          return b.dimensions.area - a.dimensions.area;
        });
      const maxDimensions = sortedPaths[0].dimensions;
      const threshold = maxDimensions.area * 0.9;
      const isDesaturatedStateCandidate = (path) => {
        let fillColor = path.attributes.getNamedItem('fill').nodeValue ?? '#ffffff'
        if (fillColor == 'none') {
          fillColor = '#ffffff'
        }
        
        
        const [h,s,v] = chroma(fillColor).hsv()
        return s == 0 && v < 1


      }
      const stateCandidate = sortedPaths.find(
        (p) => p.dimensions.area < threshold && isDesaturatedStateCandidate(p.path)
      );
      return stateCandidate;
    };


    const displayScreenPoint = (label, {x,y, width = 1, height = 1}) => {
        const pointBox = `<div title="${label}" style="position: absolute; left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px; background-color: rgba(150,100,100,0.5);"></div>`
        runtime.refs.$mc.appendChild(parser.parseFromString(pointBox, 'text/html').body.children[0])
    }

    // now we pass in the lat/longs to the SVG as meta elements

    const labeledElements = (svg) => {
      return [...svg.querySelectorAll('tspan[aria-label]')].filter(el => `${el.ariaLabel}`.length > 2 )
    }


    /*
    ChatGPT function:
    Can you write a function in javascript that takes any SVG element that provides getBBox() and an instance of an svg path that describes a polygon, and returns the amount of overlap between the bounding box and the potential polygon that may contain the bounding box? If there is no intersection, the function should return 0. 
    */
    function getBoundingBoxOverlap(svgElement, polygonPath) {
      // Get the bounding box of the SVG element
      const bbox = svgElement.getBBox();
    
      // Get the screen transformation matrix for the SVG element
      const screenCTM = svgElement.getScreenCTM();
      function svgPointToScreenPoint(ctm, {x,y}) {
        const p = svgElement.ownerSVGElement.createSVGPoint()
        p.x = x
        p.y = y
        const screenPoint = p.matrixTransform(ctm)
        return screenPoint
      }
    
      // Normalize the bounding box coordinates to screen units using the screen transformation matrix

      const bboxMin = { x: bbox.x, y: bbox.y };
      const bboxMax = { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
      const screenBboxMin = svgPointToScreenPoint(screenCTM, bboxMin)
      const screenBboxMax = svgPointToScreenPoint(screenCTM, bboxMax)

      const withinBox = polygonPath.getBoundingClientRect()
      const withinMin = {x: withinBox.x, y: withinBox. y}
      const withinMax = {x: withinBox.x + withinBox.width, y: withinBox.y + withinBox.height}

    
      // Parse the polygon path data into an array of points
      const polygonPoints = polygonPath
        .getAttribute("d")
        .match(/-?\d+(?:\.\d+)?/g)
        .map(Number)
        .reduce((points, coord, index, coords) => {
          if (index % 2 === 0) {
            points.push({ x: coord, y: coords[index + 1] });
          }
          return points;
        }, []);
    
      // Normalize each point to screen units using the inverse of the screen transformation matrix
      const testBBox = polygonPoints.every((point) => {
        // are any points opposite of the bbox
        return polygonPoints.find( op => {
          if (point.x < screenBboxMin.x && op.x > screenBboxMax.x) {
            if (point.y < screenBboxMin.y && op.y > screenBboxMax.y) {
              return true
            }
          }
        })
      });
      

      const isInside = screenBboxMax.x < withinMax.x && screenBboxMin.x > withinMin.x && screenBboxMax.y < withinMax.y && screenBboxMin.y > withinMin.y 
    
      // Check if any of the polygon points are inside the bounding box
    
      if (!isInside) {
        // No overlap between the bounding box and the polygon
        return {isInside: false, intersectionArea: 0}
      }
    
      // Calculate the area of the intersection between the bounding box and the polygon
      const minX = Math.max(screenBboxMin.x, polygonPoints.reduce((min, { x }) => Math.min(min, x), Infinity));
      const maxX = Math.min(screenBboxMax.x, polygonPoints.reduce((max, { x }) => Math.max(max, x), -Infinity));
      const minY = Math.max(screenBboxMin.y, polygonPoints.reduce((min, { y }) => Math.min(min, y), Infinity));
      const maxY = Math.min(screenBboxMax.y, polygonPoints.reduce((max, { y }) => Math.max(max, y), -Infinity));
      const intersectionArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    
      return {isInside, intersectionArea}
    }


    const resolveDistrictPaths = (svg) => {
      const stateBox = statePath.path.getBoundingClientRect()
      const allPaths = [...svg.querySelectorAll('path[fill][fill-opacity="1"]:not([stroke])')] // candidate district paths have fill and opacity
      const inStatePaths = allPaths.filter( path => {
        const pathCenter = getCenterOfBox(path.getBoundingClientRect())
        const isWithinState = isPointWithinBox(pathCenter, stateBox)
          path.setAttribute('is-within-state', isWithinState)
        if (isWithinState) {
          let [h,s,v] = chroma(path.getAttribute('fill')).hsv()
          path.setAttribute('color-s', s)
          let isSaturated = s > .20
          return isSaturated
        }
      })
      const textElements = labeledElements(svg)
      const textPathMap = textElements.reduce((result, textElement) => {
        const text = textElement.attributes['aria-label'].value
        const polyPaths = R.pipe(
          R.filter( currentPath => {

            const overlap = getBoundingBoxOverlap(textElement, currentPath)
            let result = overlap.isInside
            currentPath.overlap = overlap
            return result
          }),
          R.sortBy(path => {
            // what is the overlap between this path's bounding box and the candidate path?
            return path.overlap.intersectionArea
          })
        )(inStatePaths)
        const textContainedPath = polyPaths.at(-1)
        

        // since we don't have anything to bind the lines of each district together until this point
        // we can use the fact that the lines of text inside the district's text elements all resolve
        // to the same element
        if (textContainedPath && text.length > 2) { 
          const key = textContainedPath.attributes['d'].value
          if (result[key]) {
            result[key] = result[key] + ' ' + text
          } else {
            result[key] = text 
          }
        }
        return result
      }, {})

      return Object.entries(textPathMap).reduce( (result, [pathAttribute, text]) => {
        const inStatePath = inStatePaths.find(p => p.attributes['d'].value === pathAttribute)
        result[text] = inStatePath
        return result
      }, {})

    }


    const showStaticMap = () => {
      const { bl, tr } = containerFeature.geo.points
      const lats = [bl.y, tr.y].sort( (a,b) => a - b)
      const lons = [ bl.x, tr.x ].sort( (a,b)=> a - b)


      let url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/[${lons[0]},${lats[0]},${lons[1]},${lats[1]}]/${baseWidth}x${targetHeight}?access_token=${mbT}`
      document.querySelector('#map-overlay').setAttribute('src', url)

    }
    const showMap = async (geoPaths) => {
      mapboxgl.accessToken = mbT
      const interactiveMap = document.querySelector('#map-interactive-overlay')
      interactiveMap.style.width = `${baseWidth}px`
      interactiveMap.style.height = `${targetHeight}px`

      mbMap = new mapboxgl.Map({
        container: 'map-interactive-overlay', // container ID
        // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
        interactive: true,
        bounds: [
          [
            containerFeature.geo.points.bl.x,
            containerFeature.geo.points.bl.y,
          ],
          [
            containerFeature.geo.points.tr.x,
            containerFeature.geo.points.tr.y,
          ]
        ]
      });
       
      mbMap.on('load', () => {
        mbMap.resize()
        for (const [name, attrs] of Object.entries(geoPaths)) {
          const pathIndex = Object.keys(geoPaths).indexOf(name)
          const {svgPath, geoPath} = attrs
          if (attrs) {
            mbMap.addSource(name, {
              type: 'geojson',
              data: geoPath
            })
          }
          // Add a data source containing GeoJSON data.
          // Add a new layer to visualize the polygon.
          const layer = mbMap.addLayer({
          'id': `fill-${pathIndex}`,
          'type': 'fill',
          'source': name,
          'layout': {},
          'paint': {
            'fill-color': svgPath.fill ?? '#0080ff', // blue color fill
            'fill-opacity': 0.15
            }
          });
        
          // Add a black outline around the polygon.
          mbMap.addLayer({
            'id': `outline-${pathIndex}`,
            'type': 'line',
            'source': name,
            'layout': {},
            'paint': {
              'line-color': '#000',
              'line-width': 1
            }
          });
          mbMap.addLayer({
            'id': `text-${pathIndex}`,
            'type': 'symbol',
            'source': name,
            'layout': {
              'text-field': '{title}'
            }
          });
          mbMap.scrollZoom.disable()
        }
        mbMap.on('click', `fill-${name}`, (e) => {
          const {lng, lat} = e.lngLat
          const coopListElement = document.querySelector('#coop-list')
          const [name, paths] = Object.entries(geoPaths).find( ([name, paths]) => {
            const tDistrict = turf.feature(paths.geoPath.geometry)
            const p = turf.point(lng, lat)
            return turf.booleanContains(tDistrict, p)
          })
          console.log('clicked', name, paths)
          coopListElement.value = name
          coopListElement.trigger('click')
        })
      })
    }
    const pathDimensions = (pathElement) => {
        const clientRect = pathElement.getBBox();
        return {
          clientRect,
          area: clientRect.width * clientRect.height
        };
      };

    const processFiles = async () => {

      runtime.showProgress('Reading PDF')
      const pdfBytes = await readAsBytes(document.querySelector("#pdfDocument"));
      csvText = await readAsText(document.querySelector('#contactDocument'))

      runtime.showProgress('Loading PDF')
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      const pdf = await new Promise((resolve, reject) => {
        loadingTask.promise.then(resolve);
      });

      async function renderPageToSVG(pageNumber, contextID) {
        runtime.showProgress('Rendering PDF', `Page ${pageNumber}`)
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.0 });
        const opList = await page.getOperatorList();
        // use custom class for aria-label transformation
        const svgGfx = new SVGGraphicsOverride(page.commonObjs, page.objs);
        svgGfx.embedFonts = false;
        let doc = await svgGfx.getSVG(opList, viewport);
        // Prepare canvas using PDF page dimensions
        doc.id = contextID;
        document.querySelector(`#${contextID}`).replaceWith(doc);
        return doc
      }

      const svg = await renderPageToSVG(1, 'svg-context')
      svgRoot = document.querySelector("#svg-context");
      const selectedState = document.querySelector("#state-list").value;
      runtime.showProgress('State identified', selectedState)
      stateGeo = stateGeos.features.find((f) => {
        return f.properties.NAME === selectedState;
      });
      const [west, south, east, north] = geojsonExtent(stateGeo);
      stateFeature.geo.box = {
        x: west,
        y: north,
        width: Math.abs(west - east),
        height: Math.abs(north - south)
      }

      statePath = findStatePath();
      stateFeature.svgPath = statePath.path
      statePath.path.stroke = "#ff0000"
      const state = UnitedStates.find(state => state.name === selectedState)
      zipGeos = (await fetchStateZipGeos(state))
      const allZipCounts = Object.keys(zipProperties).length
      let zipCurrent = 0;
      for (const [zip, areas] of Object.entries(zipProperties)) {
        const feature = zipGeos.features.find( feature => {
          const geoZip = feature.properties.ZCTA5CE10
          return geoZip == zip
        })
        if (feature) {
          const [west, south, east, north] = geojsonExtent(feature)
          const zipBox = {
            x: west,
            y: north,
            width: Math.abs(west - east),
            height: Math.abs(north - south)
          }
          const originalProperties = {...feature?.properties}
          feature.properties = {
            ...feature.properties,
            "NAME": areas.zipName,
            "BOX": zipBox
          }
        }
        zipCurrent += 1;
        runtime.showProgress('Loading ZIP Data', `${(zipCurrent/ allZipCounts)*100} % loaded`)
      }
debugger

      containerFeature.svgPath = statePath.path.ownerSVGElement

      containerFeature.screen.box = containerFeature.svgPath.getBoundingClientRect();
      containerFeature.screen.bounds = zeroOrigin(containerFeature.screen.box)

      stateFeature.screen.box = boundsRelativeTo(statePath.path.getBoundingClientRect(), containerFeature.screen.box)
      stateFeature.view.bounds = boundsRelativeTo(statePath.path.getBBox(), svg.getBBox())
      stateFeature.screen.bounds = boundsRelativeTo(stateFeature.screen.box, containerFeature.screen.box)

      //statePathViewBox (non-relative to container 0), statePathScreenBounds, geo
      //west, south, east, north order.
      stateFeature.view.box = stateFeature.svgPath.getBBox()

      var [tl, tr, br, bl] = pointsForBox(stateFeature.geo.box)
      stateFeature.geo.points = {tl, tr, br, bl}

      runtime.transformers.vXs = new SimpleShapeReferenceConverter(stateFeature.view.bounds, stateFeature.screen.bounds, {
          invertY: true
      })

      runtime.showProgress('Finding primary state path')
      const containerRect = containerFeature.svgPath.getBoundingClientRect()
      const stateRect = boundsRelativeTo(stateFeature.svgPath.getBoundingClientRect(), containerRect)
      runtime.transformers.sXg = new SimpleShapeReferenceConverter(stateRect, stateFeature.geo.box)
      containerFeature.geo.box = runtime.transformers.sXg.sourceToTarget(containerFeature.screen.box)
      containerFeature.geo.bounds = runtime.transformers.sXg.sourceToTarget(containerFeature.screen.bounds)
      runtime.showProgress('Bounds calculated', `lat: ${containerFeature.geo.bounds.x} / lng: ${containerFeature.geo.bounds.y}`)
      const geoContainer = runtime.transformers.sXg.sourceToTargetBounds(containerFeature.screen.bounds)

      var [tl,tr,br,bl] = pointsForBox(geoContainer)
      containerFeature.geo.points = { tl, tr, br, bl}


      baseWidth = containerFeature.screen.box.width
      targetHeight =  parseInt(baseWidth * containerFeature.screen.box.height / containerFeature.screen.box.width)

      const textPaths = resolveDistrictPaths(svg)
      const coopListElement = document.querySelector('#coop-list')
      coopListElement.removeAttribute('disabled')
      coopListElement.innerHTML = ""

      
      const districtNames = Object.keys(textPaths)
      coopListElement.innerHTML += "<option selected>Choose a coop</option>"
      geoPaths = Object.entries(textPaths).reduce((result, [districtName, svgPath]) => {
        const i = districtNames.indexOf(districtName)
        runtime.showProgress('Processing path', `${districtName} (${i}/${districtNames.length})`)

        const districtIndex = Object.keys(textPaths).indexOf(districtName)
          const geoPath = geoFeatureForMatch(districtName, svgPath)
          result[districtName] = {
            svgPath,
            geoPath,
          }

          coops.push({
            districtName,
            svgPath,
            geoPath
          })

        return result
      }, {})
    for (const districtName of Object.keys(textPaths).sort()) {
      coopListElement.innerHTML += `<option value="${districtName}">${districtName}</option>`
    }
      

      
     // await showStaticMap()
      await showMap(geoPaths)
    }

    const geoFeatureForMatch = (name, pathElement) => {
      const pathLength = pathElement.getTotalLength();
      const geoCoords = [];
      
      const owner = containerFeature.svgPath
      const pathScreenCTM = pathElement.getScreenCTM()
      const pathInternalViewBox = pathElement.getBBox()
      const p = owner.createSVGPoint()
      p.x = pathInternalViewBox.x
      p.y = pathInternalViewBox.y

      const transformed = pointRelativeTo(p.matrixTransform(pathScreenCTM), owner.getBoundingClientRect())
      const pathScreenBox = {
        width: pathInternalViewBox.width,
        height: pathInternalViewBox.height,
        x: transformed.x,
        y: transformed.y - pathInternalViewBox.height
      }
      
    


     const pathScreenBoxElement = parser.parseFromString(`
       <div style="position: absolute; left: ${pathScreenBox.x}px; top: ${pathScreenBox.y}px; width: ${pathScreenBox.width}px; height: ${pathScreenBox.height}px; border: 1px solid rgba(255,0,255,0.33);" title="${name}"></div>
       `, 'text/html')

      runtime.refs.$mc.querySelector('.overlays-container').appendChild(pathScreenBoxElement.body.children[0])
      const ownerRect = owner.getBoundingClientRect()
      for(let i=0; i<pathLength; i+=5) {
        const point = pathElement.getPointAtLength(i);
        const screenPoint = pointRelativeTo(
          point.matrixTransform(pathScreenCTM), 
          ownerRect)

        const geoPoint = runtime.transformers.sXg.sourceToTarget(screenPoint)
        geoCoords.push({
          x: geoPoint.x,
          y: geoPoint.y
        })
      }
      
      const geometry = {
        type: 'LineString',
        coordinates: geoCoords.map(coord => [coord.x, coord.y])
      };

      const properties = {
        name,
        title: name,
      }

      const feature = {
        type: 'Feature',
        geometry,
        properties

      }

      const [west, south, east, north] = geojsonExtent(feature)
      const dBox = {
        x: west,
        y: north,
        width: Math.abs(west - east),
        height: Math.abs(north - south)
      }
      feature.properties = feature.properties || {}
      feature.properties.BOX = dBox

      const convex = turf.convex(feature, { concavity: 1, properties: feature.properties})
      return convex
    }


    processFiles()

    const freshZipMatch = () => ({contained: [], crossed: [], errored: []})
    const featureMatchesFor = (zipGeo, districtGeo, result) => {
      // flatten everything
      const zipFeatures = turf.flatten(turf.polygonToLineString(zipGeo))
      const districtFeatures = turf.flatten(districtGeo)
      for (const districtFeature of districtFeatures.features) {
        for (const zipFeature of zipFeatures.features) {
          try {
            if (turf.booleanContains(districtFeature, zipFeature)) {
              result.contained.push(zipFeature)
            }
            if (turf.booleanCrosses(districtFeature, zipFeature)) {
              result.crossed.push(zipFeature)
            }
          } catch (e) {
            zipFeature.errors = zipFeature.errors || []
            zipFeature.errors.push(e)
            result.errored.push(zipFeature)
          }
        }
      }
      return result
    }
    document.querySelector('#coop-list').addEventListener('change', (e) => {
      const matchingZips = []
      const selectedName = e.target.selectedOptions[0].value
      const districtGeo = geoPaths[e.target.selectedOptions[0].value].geoPath
      const zipMatches = zipGeos.features.reduce((result, zipGeo) => {
        return featureMatchesFor(
          zipGeo, 
          districtGeo, result)
      }, freshZipMatch())
      const zipsContained = zipMatches.contained.map(zip => zip.properties.ZCTA5CE10)
      const matches = csvText.split("\n").filter(line => zipsContained.some( zip => line.includes(`"${zip}"`)))
      document.querySelector('#candidate-zips-contained').innerHTML = `<h2>Full Matches</h2><br/>
      <ul>
        <li><a class='download-matches' download="${selectedName}.zipMatches.csv" target='_blank'>${matches.length} matched</a> in CSV</li>
        ${zipMatches.contained.map(zip => `<li>${zip.properties.ZCTA5CE10}</li>`).join('')}
      </ul>
      `
      const base64DownloadMatches = btoa(matches.join("\n"))
      document.querySelector('.download-matches').setAttribute('href', `data:text/csv;base64,${base64DownloadMatches}`)


      document.querySelector('#candidate-zips-crossed').innerHTML = `<h2>Partial Matches</h2><br/>
      <ul>
        ${zipMatches.crossed.map(zip => `<li>${zip.properties.ZCTA5CE10}</li>`).join('')}
      </ul>
      `
      
      document.querySelector('#candidate-zips-errored').innerHTML = `<h2>Errored Matches</h2><br/>
      <ul>
        ${zipMatches.errored.map(zip => `<li>
        ${zip.properties.ZCTA5CE10}
        
        ${zip.properties.error}
        </li>`).join('')}
      </ul>
      `

      const allMatches = R.uniqBy(R.path(['properties', 'ZCTA5CE10']), [...zipMatches.contained, ...zipMatches.crossed])
      for (const zipFeature of allMatches) {
        const zip = zipFeature.properties.ZCTA5CE10
        mbMap.addSource(zip, {
          type: 'geojson',
          data: zipFeature
        })
        const isContained = zipMatches.contained.map(R.path(['properties', 'ZCTA5CE10'])).includes(zipFeature.properties.ZCTA5CE10)
        const maxBrightness = isContained ? 255 : 128
        const randomColor = [
          String(parseInt(Math.random() * maxBrightness).toString(16)).padStart(2, '0'),
          String(parseInt(Math.random() * maxBrightness).toString(16)).padStart(2, '0'),
          String(parseInt(Math.random() * maxBrightness).toString(16)).padStart(2, '0')
        ].join('')
        mbMap.addLayer({
        'id': `fill-${zip}`,
        'type': 'fill',
        'source': zip,
        'layout': {},
        'paint': {
          'fill-color': `#${randomColor}`,
          'fill-opacity': isContained ? 0.75 : 0.25
          }
        });

        mbMap.addLayer({
          'id': `outline-${zip}`,
          'type': 'line',
          'source': zip,
          'layout': {},
          'paint': {
            'line-color': `#${randomColor}`,
            'line-width': 1,
            'line-opacity': 0.75
          }
        });

      }
    })



  });
  setTimeout(() => runtime.showProgress('Ready'), 1000);

const findStatePath = () => {};
const findParentCoords = () => {};

