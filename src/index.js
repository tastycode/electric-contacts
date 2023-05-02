//import stateGeos from "./gz_2010_us_040_00_500k.json";
import "./styles.css";
import geojsonExtent from "@mapbox/geojson-extent";
import mapboxgl from 'mapbox-gl'
import { SVG } from '@svgdotjs/svg.js'
import * as turf from '@turf/turf'

import { geoFromSVGXML } from 'svg2geojson'
import * as R from 'ramda'
import UnitedStates from 'states-us'

var pdfjsLib = require("pdfjs-dist");
const toBBox = require("geojson-bounding-box");

let containerFeature = {
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

let stateFeature = {
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
const runtime = {
  features: {
    container: containerFeature,
    state: stateFeature
  },
  transformers: {
    sXg: null,
    vXs: null
  },
  refs: {
    $mc: null
  },
  data: {
    states: [],
    selectedState: null,
    districts: [],
    selectedDistrict: null
  }
}
// 5 contacts randomly around in arkansas
const contacts = [
  {
    name: "Joe Matthew",
    address: "2222 W Poplar, Arkansas",
    location: [35.482569, -92.022929] // First Electric
  },
  {
    name: "Chris Matthew",
    address: "1000 W Poplar, Arkansas",
    location: [34.195902, -91.958742] // C&L EC
  },
  {
    name: "Chris Matthew",
    address: "1000 W Poplar, Arkansas",
    location: [35.206652, -94.131441] // AR Valley EC
  }
];

const updateStyles = (changes = {
  opacity: 0.5
}) => {
  document.querySelector('#map-overlay').style.opacity = opacity
  document.querySelector('#map-interactive-overlay').style.opacity = opacity + 0.25
  

}

// obviously, there are other ways to do this
// in the absence of a known deployment environment
// this is enough for me to use my own token
//
let mbT = 'pk.eyJ1IjoidGF'
mbT = `${mbT}zdHljb2RlMiI`
mbT = `${mbT}sImEiOiJjbGd`
mbT = `${mbT}iNHdnOGEwb28`
mbT = `${mbT}wM2pxcDB6amt`
mbT = `${mbT}rN3kwIn0.zuX`
mbT = `${mbT}HfjoFOj73cV_`
mbT = `${mbT}ni3t3UA`


pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry.js");
document.getElementById("app").innerHTML = `
<h1>REC District Contact Filter</h1>
<p>
The PDF files for this tool are available at <a href="https://www.cooperative.com/programs-services/government-relations/Pages/Congressional-District-Maps.aspx" target="_blank">cooperative.com</a>.
</p>
<div>
<p>
  <label for="pdfDocument">PDF Map</label><br/>
  <input type="file" name="pdfDocument" id="pdfDocument" accept="application/pdf, application/x-pdf"/>
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
      <select id="coop-list"></select>
  </p>
  
  
  <canvas id="pdf-canvas"></canvas>
  <div class="maps-container">
      <svg id="svg-context"></svg>
      <img id="map-overlay"/>
      <div id="map-interactive-overlay"/></div>
  </div>
  <div class="contacts-container">
      <svg id="svg-contacts"></svg>
  </div>
  <div id='candidate-zips-contained'>
  </div>
  <div id='candidate-zips-crossed'>
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
    reader.readAsText(inputNode.files[0]);
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

  showText = (glyphs) => {
    for (const glyph of glyphs) {
      if (glyph && glyph.unicode !== undefined)
        this._currentSvgText += glyph.unicode;
    }
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
    this.current.txtElement.setAttribute("aria-label", svgText);
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
  .querySelector("input[type=submit]")
  .addEventListener("click", async () => {


    // todo: all these share too much state, refactor

    let statePath, svg, geoContainerTL,  containerScreenBox, svgRoot,  stateGeo, xGeoRatio, yGeoRatio,  baseWidth, targetHeight, geoPointForScreenPoint,  coops, zipGeos, geoPaths, mbMap

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
      const stateCandidate = sortedPaths.find(
        (p) => p.dimensions.area < threshold
      );
      return stateCandidate;
    };


    const displayScreenPoint = (label, {x,y, width = 1, height = 1}) => {
        const pointBox = `<div title="${label}" style="position: absolute; left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px; background-color: rgba(150,100,100,0.5);"></div>`
        runtime.refs.$mc.appendChild(parser.parseFromString(pointBox, 'text/html').body.children[0])
    }

    // now we pass in the lat/longs to the SVG as meta elements

    // pass into svg2geojson library
    const removeNameSpace = (root) => {    
      //https://stackoverflow.com/questions/4505103/how-to-remove-xml-namespaces-using-javascript
      let parentElement = document.createElement(root.localName);
      let nodeChildren = root.childNodes;
      for (let i = 0; i < nodeChildren.length; i++)  {
          let node = nodeChildren[i];
          if(node.nodeType == 1){
              let child
              if(node.childElementCount!=0)
                  child = removeNameSpace(node);
              else{
                  child = document.createElement(node.localName);
                  let textNode = document.createTextNode(node.innerHTML);
                  child.append(textNode);
              }
              parentElement.append(child);
          }
      }
      return parentElement;
    }
    const prepareSVG = (svg) => {
      const cleanRoot = removeNameSpace(svg)
      const svgFragment = `
      <MetaInfo xmlns="http://www.prognoz.ru"><Geo>
        <GeoItem X="${svgTL.x}" Y="${svgTL.y}" Latitude="${geoStateTL.y}" Longitude="${geoTL.x}"/>
        <GeoItem X="${svgBR.x}" Y="${svgBR.y}" Latitude="${geoStateBR.y}" Longitude="${geoBR.x}"/>
      </Geo></MetaInfo>`



      const regex = /(<svg[^>]*>)/
      const metaInfo = svgFragment.trim();
      const newSvg = cleanRoot.outerHTML.replace(regex, `$1${metaInfo}`);
      return newSvg
    }

    const labeledElements = (svg) => {
      return [...svg.querySelectorAll('*[aria-label]')]
    }



    const translateSvgCoordinate = (x,y) => {
      var pt = svg.createSVGPoint()
      pt.x = x
      pt.y = y
      const transformed =pt.matrixTransform(svg.getScreenCTM())
      // calculate viewBox transformation
      const geoX = transformed.x * xGeoRatio + geoContainerTL.x
      const geoY = transformed.y * yGeoRatio + geoContainerTL.y
      return [geoX, geoY]
    }
    const pathToSvgCoords = (svgPathElement) => {

      const pathLength = svgPathElement.getTotalLength();
      const viewBox = svgPathElement.ownerSVGElement.viewBox.baseVal; // get the viewbox

      const coords = [];

      for(let i=0; i < pathLength; i+=2) {
        const point = svgPathElement.getPointAtLength(i);
        const x = point.x * viewBox.width / svgPathElement.getBoundingClientRect().width + viewBox.x
        const y = point.y * viewBox.height / svgPathElement.getBoundingClientRect().height + viewBox.y
        coords.push([x, y])
      }
      return coords
    }

    const resolveDistrictPaths = (svg) => {
      const stateBox = statePath.path.getBoundingClientRect()
      const maxCandidateArea = stateBox.width * stateBox.height * 0.90
      const allPaths = [...svg.querySelectorAll('path')]
      const inStatePaths = allPaths.filter( path => {
        const pathCenter = getCenterOfBox(path.getBoundingClientRect())
        return isPointWithinBox(pathCenter, stateBox)
      })
      const textElements = labeledElements(svg)
      const textPathMap = textElements.reduce((result, textElement) => {
        const text = textElement.attributes['aria-label'].value
        const textBox = textElement.getBoundingClientRect()
        const textCenter = getCenterOfBox(textBox)
        const textArea = textBox.width * textBox.height
        const polyPaths = R.pipe(
          R.filter( currentPath => {
            let result = true
            const currentBox = currentPath.getBoundingClientRect()
            result = result && isPointWithinBox(textCenter, currentBox)
            const currentArea = currentBox.width * currentBox.height
            result = result && currentArea < maxCandidateArea
            result = result && currentArea > textArea
            return result
          }),
          R.sortBy(path => {
            // what is the overlap between this path's bounding box and the candidate path?
            const currentPathBox = path.getBoundingClientRect()
            const overX = Math.min(0, textBox.x + textBox.width - currentPathBox.x + runtime.features.state.screen.box.width)
            const overY = Math.min(0, textBox.y +  textBox.height - currentPathBox.y + runtime.features.state.screen.box.height)
            const underX = Math.min(currentPathBox.x - textBox.x, 0)
            const underY = Math.min(currentPathBox.y - textBox.y, 0)
            const total = overX + overY + underX + underY
            return total
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
        style: 'mapbox://styles/mapbox/light-v11', // style URL
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
        mbMap.addLayer({
        'id': `fill-${pathIndex}`,
        'type': 'fill',
        'source': name,
        'layout': {},
        'paint': {
          'fill-color': svgPath.fill ?? '#0080ff', // blue color fill
          'fill-opacity': 0.5
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

      const pdfBytes = await readAsBytes(document.querySelector("#pdfDocument"));
      const csvText = await readAsText(document.querySelector('#contactDocument'))

      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      const pdf = await new Promise((resolve, reject) => {
        loadingTask.promise.then(resolve);
      });

      async function renderPageToSVG(pageNumber, contextID) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.0 });
        const opList = await page.getOperatorList();
        const svgGfx = new SVGGraphicsOverride(page.commonObjs, page.objs);
        svgGfx.embedFonts = false;
        let doc = await svgGfx.getSVG(opList, viewport);
        // Prepare canvas using PDF page dimensions
        doc.id = contextID;
        document.querySelector(`#${contextID}`).replaceWith(doc);
        return doc
      }

      const svg = await renderPageToSVG(1, 'svg-context')
      const $svg = SVG(svg)
      await renderPageToSVG(2, 'svg-contacts')

      svgRoot = document.querySelector("#svg-context");
      statePath = findStatePath();
      stateFeature.svgPath = statePath.path
      statePath.path.stroke = "#ff0000"
      //stateCountyGeos = fetchStateZipGeos()
      // now we have a bounding box for the whole state
      // we also know the true bounding box in latitude and longitude
      // given the position of the state bounding box within the
      // parent bounding box, we can get the lat/long bounding box coordinates
      // of the parent

      // get SVG bounding box


      const selectedState = document.querySelector("#state-list").value;
      stateGeo = stateGeos.features.find((f) => {
        return f.properties.NAME === selectedState;
      });
      const state = UnitedStates.find(state => state.name === selectedState)
      zipGeos = (await fetchStateZipGeos(state))
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
      }
      const zipIndex = zipGeos.features.reduce( (result, feature) => {
        const zip = feature.properties.ZCTA5CE10
        result[zip] = feature
        return result
      }, {})


      containerFeature.svgPath = statePath.path.ownerSVGElement

      containerFeature.screen.box = containerFeature.svgPath.getBoundingClientRect();
      containerFeature.screen.bounds = zeroOrigin(containerFeature.screen.box)

      stateFeature.screen.box = boundsRelativeTo(statePath.path.getBoundingClientRect(), containerFeature.screen.box)
      stateFeature.view.bounds = boundsRelativeTo(statePath.path.getBBox(), svg.getBBox())
      stateFeature.screen.bounds = boundsRelativeTo(stateFeature.screen.box, containerFeature.screen.box)

      //statePathViewBox (non-relative to container 0), statePathScreenBounds, geo
      //west, south, east, north order.
      const [west, south, east, north] = geojsonExtent(stateGeo);

      stateFeature.geo.box = {
        x: west,
        y: north,
        width: Math.abs(west - east),
        height: Math.abs(north - south)
      }
      stateFeature.view.box = stateFeature.svgPath.getBBox()

      var [tl, tr, br, bl] = pointsForBox(stateFeature.geo.box)
      stateFeature.geo.points = {tl, tr, br, bl}

      runtime.transformers.vXs = new SimpleShapeReferenceConverter(stateFeature.view.bounds, stateFeature.screen.bounds, {
          invertY: true
      })

      const containerRect = containerFeature.svgPath.getBoundingClientRect()
      const stateRect = boundsRelativeTo(stateFeature.svgPath.getBoundingClientRect(), containerRect)
      runtime.transformers.sXg = new SimpleShapeReferenceConverter(stateRect, stateFeature.geo.box)
      containerFeature.geo.box = runtime.transformers.sXg.sourceToTarget(containerFeature.screen.box)
      containerFeature.geo.box.y = 
      containerFeature.geo.bounds = runtime.transformers.sXg.sourceToTarget(containerFeature.screen.bounds)


      // compute a transform that produces svg screen from svg view space
      const screenPointForViewPoint = ({x, y}, relativeToContainer = true) => {
        const screenPoint = runtime.transformers.vXs.sourceToTarget({x,y})
        if (relativeToContainer) {
          return pointRelativeTo(screenPoint, containerFeature.screen.box)
        }
        return screenPoint

       var p = svg.createSVGPoint()
        p.x = x
        p.y = y
        const txd = p.matrixTransform(svg.getCTM());
        if (relativeToContainer) {
          return {
            x: (containerViewBox.x + txd.x) * xViewRatio,
            y: (containerViewBox.y - txd.y) * yViewRatio,
          }
        } else {
          return {
            x: xViewLeft * xViewRatio,
            y: yViewTop * yViewRatio
          }
        }
      }

      const viewToScreenBounds = ({x,y,width,height}) => {
        return runtime.transformers.vXs.sourceToTargetBounds({x,y,width,height})
      }




      // compute a transform that produces geo from SVG screen
      /*

      pixelWidth         pixelLeft
      ----------    =   ---------
      geoWidth           geoLeft
      */
      const {x: geoLeft, y: geoTop } = runtime.transformers.sXg.sourceToTarget(containerFeature.screen.bounds)

//      const geoLeft = geoStateBounds.x - (statePathScreenBounds.x)*xGeoRatio
 //     const geoTop = geoStateBounds.y - (statePathScreenBounds.y)*yGeoRatio


      geoPointForScreenPoint = ({x, y}) => {
        return runtime.transformers.sXg.sourceToTarget({x,y})

        const left = x - containerScreenBox.left
        const top = y - containerScreenBox.top
        if (left < 0 || top < 0) {
          console.error('All points should be within svg containing box')
        }
        return {
          x: geoLeft + (left * xGeoRatio),
          y: geoTop - (top * yGeoRatio)
        }
      }

      const screenPointForGeo = ({x, y}) => {
        return runtime.transformers.sXg.targetToSource({x,y})
        const xDistance = (x - geoLeft) / xGeoRatio
        const yDistance = (y - geoTop) / yGeoRatio
        return {
          x: containerScreenBox.left + xDistance,
          y: containerScreenBox.top + yDistance
        }
      }

      const screenToGeoBounds = ({x,y,width,height}) => {
        return runtime.transformers.sXg.sourceToTargetBounds({x,y,width,height})
        const { x: geoX, y: geoY} = geoPointForScreenPoint({x,y})
        return {
          x: geoX,
          y: geoY,
          width: width * xGeoRatio,
          height: height * yGeoRatio
        }

      }
      const geoContainer = runtime.transformers.sXg.sourceToTargetBounds(containerFeature.screen.bounds)
      var geoContainerWidth = geoContainer.width
      var geoContainerHeight = geoContainer.height

      // to test, we just get the bbox of the statePath and compare ocords
      //pathViewBox // svg internal view
      //statePathScreenBox // screen
    //var [ a, b, c, d] = pointsForBox(runtime.transformers.sXg.sourceToTargetBounds(stateFeature.screen.bounds))
    var [tl,tr,br,bl] = pointsForBox(geoContainer)
    containerFeature.geo.points = { tl, tr, br, bl}


      const NS = svg.getAttribute('xmlns');
      const aspect = containerFeature.screen.box.width / containerFeature.screen.box.height
      baseWidth = containerFeature.screen.box.width
      targetHeight =  parseInt(baseWidth * containerFeature.screen.box.height / containerFeature.screen.box.width)


      //var url = `https://maps.googleapis.com/maps/api/staticmap?auto=&scale=2&size=600x300&maptype=roadmap&format=png&key=AIzaSyBEPtIQzAXpTxTkRbGzKuG1p1N7i6g9bAI&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C1%7C${geoContainerTL.y}%2C${geoContainerTL.x}|&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C2%7C${geoContainerBR.y}%2C${geoContainerBR.x}`

      const textPaths = resolveDistrictPaths(svg)
      const coopListElement = document.querySelector('#coop-list')
      coopListElement.innerHTML = ""
      // const geoPaths = { [state.name]: {
      //   svgPath: stateFeature.svgPath,
      //   geoPath: geoFeatureForMatch(state.name, statePath.path)
      // }}

      
      coopListElement.innerHTML += "<option selected>Choose a coop</option>"
      geoPaths = Object.entries(textPaths).sort((a,b) => {
        return a[0] > b[0] ? 1 : -1
      }).reduce((result, [districtName, svgPath]) => {

        const districtIndex = Object.keys(textPaths).indexOf(districtName)
          const geoPath = geoFeatureForMatch(districtName, svgPath)
          coopListElement.innerHTML += `<option>${districtName}</option>`
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
      
     // await showStaticMap()
      await showMap(geoPaths)
    }

    const geoFeatureForMatch = (name, pathElement) => {
      const pathLength = pathElement.getTotalLength();
      const geoCoords = [];

      const isDimensionValid = (dimension) => {
        return dimension !== Infinity && dimension !== NaN
      }

      
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
      
    


    // const pathScreenBoxElement = parser.parseFromString(`
    //   <div style="position: absolute; left: ${pathScreenBox.x}px; top: ${pathScreenBox.y}px; width: ${pathScreenBox.width}px; height: ${pathScreenBox.height}px; border: 1px solid rgba(255,0,255,0.33);">${name}</div>
    //   `, 'text/html')

    //   runtime.refs.$mc.appendChild(pathScreenBoxElement.body.children[0])
      for(let i=0; i<pathLength; i+=1) {
        const point = pathElement.getPointAtLength(i);
        const screenPoint = pointRelativeTo(
          point.matrixTransform(pathScreenCTM), 
          owner.getBoundingClientRect())

        const geoPoint = runtime.transformers.sXg.sourceToTarget(screenPoint)
       // geoPoint.y = stateFeature.geo.box.y + (geoPoint.y - stateFeature.geo.box.y)  // debt
        //const screenRelativePoint = screenPointForViewPoint(point, false)
        //
       // const pointBox = `<div style="position: absolute; left: ${screenPoint.x}px; top: ${screenPoint.y}px; width: 1px; height: 1px; background-color: rgba(255,100,255,0.5);"></div>`
        //runtime.refs.$mc.appendChild(parser.parseFromString(pointBox, 'text/html').body.children[0])
       // y += containerScreenBox.top
        if (isDimensionValid(screenPoint.x) && isDimensionValid(screenPoint.y)) {
          geoCoords.push({
            x: geoPoint.x,
            y: geoPoint.y
          })

        }
        


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
      feature.properties.BOX = dBox

      return turf.lineStringToPolygon(feature)
    }


    processFiles()
    document.querySelector('#coop-list').addEventListener('change', (e) => {
      const matchingZips = []
      const selectedName = e.target.selectedOptions[0].value
      const district = geoPaths[e.target.selectedOptions[0].value]
      const tDistrict = turf.feature(district.geoPath.geometry)
      const zipMatches = zipGeos.features.reduce((result, zipFeature) => {
        const tZipFeature = turf.polygonToLineString(turf.feature(zipFeature.geometry))
        const crossed = turf.booleanCrosses(tDistrict, tZipFeature)
        const crosses = zipFeature.properties.crosses ?? []
        if (crossed) {
          crosses.push(district)
          crosses = [...crosses, district]
        } 
        zipFeature.properties.crosses = crosses

        const contained = turf.booleanContains(tDistrict, tZipFeature)
        const contains = zipFeature.properties.contains ?? []
        if (contained) {
          contains.push(district)
        }
        zipFeature.properties.contains = contains
        contained && result.contained.push(zipFeature)
        crossed && result.crossed.push(zipFeature)
        return result
      }, {contained: [], crossed: []})
      document.querySelector('#candidate-zips-contains').value = `<h2>Full Matches</h2><br/>
      <ul>
        ${zipMatches.contained.map(zip => `<li>${zip.properties.ZCTA5CE10}</li>`).join('')}
      </ul>
      `
      document.querySelector('#candidate-zips-crossed').value = `<h2>Partial Matches</h2><br/>
      <ul>
        ${zipMatches.crossed.map(zip => `<li>${zip.properties.ZCTA5CE10}</li>`).join('')}
      </ul>
      `
      for (const zipFeature of [...zipMatches.contained, ...zipMatches.crossed]) {
        const zip = zipFeature.properties.ZCTA5CE10
        mbMap.addSource(zip, {
          type: 'geojson',
          data: zipFeature
        })
        const maxBrightness = zipMatches.contained.includes(zipFeature) ? 255 : 128
        const randomColor = [
          parseInt(Math.random() * maxBrightness).toString(16),
          parseInt(Math.random() * maxBrightness).toString(16),
          parseInt(Math.random() * maxBrightness).toString(16)
        ].join('')
        mbMap.addLayer({
        'id': `fill-${zip}`,
        'type': 'fill',
        'source': zip,
        'layout': {},
        'paint': {
          'fill-color': `#${randomColor}`,
          'fill-opacity': 0.5
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

const findStatePath = () => {};
const findParentCoords = () => {};

