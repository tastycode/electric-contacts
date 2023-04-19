//import stateGeos from "./gz_2010_us_040_00_500k.json";
import "./styles.css";
import geojsonExtent from "@mapbox/geojson-extent";
import mapboxgl from 'mapbox-gl'
import { geoFromSVGXML } from 'svg2geojson'
import * as R from 'ramda'

var pdfjsLib = require("pdfjs-dist");
const toBBox = require("geojson-bounding-box");

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
  <p>
  <input type="submit">

  </p>
  
  
  <canvas id="pdf-canvas"></canvas>
  <div class="maps-container">
      <svg id="svg-context"></svg>
      <img id="map-overlay"/>
      <div id="map-interactive-overlay"/></div>
  </div>
<div class="slidecontainer">
  <input type="range" min="1" max="100" value="50" class="slider" id="myRange" onChange>
</div>
</div>
`;

let stateGeos = { features: [] };
let states = [];
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

    let statePath, svg, geoContainerBL, geoContainerTR, geoContainerTL, geoStateBounds, pathStateBounds, containerBox, svgRoot, pathBox, stateGeo, xGeoRatio, yGeoRatio, pathElement, baseWidth, targetHeight, viewToScreenBounds, screenToGeoBounds, geoPointForScreenPoint, screenPointForViewPoint


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


    // now we pass in the lat/longs to the SVG as meta elements

    // pass into svg2geojson library
    const removeNameSpace = (root) => {    
      //https://stackoverflow.com/questions/4505103/how-to-remove-xml-namespaces-using-javascript
      let parentElement = document.createElement(root.localName);
      let nodeChildren = root.childNodes;
      for (let i = 0; i <nodeChildren.length; i++) {
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
        <GeoItem X="${svgBR.x}" Y="${svgBR.y}" Latitude="${geoBR.y}" Longitude="${geoBR.x}"/>
      </Geo></MetaInfo>`


      const parser = new DOMParser();

      const regex = /(<svg[^>]*>)/
      const metaInfo = svgFragment.trim();
      const newSvg = cleanRoot.outerHTML.replace(regex, `$1${metaInfo}`);
      return newSvg
    }

    const labeledElements = (svg) => {
      return [...svg.querySelectorAll('*[aria-label]')]
    }

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

      for(let i=0; i<pathLength; i+=1) {
        const point = svgPathElement.getPointAtLength(i);
        const x = point.x * viewBox.width / svgPathElement.getBoundingClientRect().width + viewBox.x;
        const y = point.y * viewBox.height / svgPathElement.getBoundingClientRect().height + viewBox.y;
        coords.push([x, y]);
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
            const overX = Math.min(0, textBox.x + textBox.width - currentPathBox.x + pathBox.width)
            const overY = Math.min(0, textBox.y +  textBox.height - currentPathBox.y + pathBox.height)
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
      let url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/[${geoContainerBL.x},${geoContainerBL.y},${geoContainerTR.x},${geoContainerTR.y}]/${baseWidth}x${targetHeight}?access_token=${mbT}`
      document.querySelector('#map-overlay').setAttribute('src', url)

    }
    const showMap = async (geoPaths) => {
      mapboxgl.accessToken = mbT
      const interactiveMap = document.querySelector('#map-interactive-overlay')
      interactiveMap.style.width = `${baseWidth}px`
      interactiveMap.style.height = `${targetHeight}px`

      const center = getCenterOfBox(statePath.path.getBBox())
      const map = new mapboxgl.Map({
        container: 'map-interactive-overlay', // container ID
        // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
        style: 'mapbox://styles/mapbox/light-v11', // style URL
        bounds: [
          [
            geoContainerBL.x,
            geoContainerBL.y
          ],
          [
            geoContainerTR.x,
            geoContainerTR.y
          ]
        ]
      });
       
      map.on('load', () => {
        map.resize()
      for (const [name, attrs] of Object.entries(geoPaths)) {
        const pathIndex = Object.keys(geoPaths).indexOf(name)
        const {svgPath, geoPath} = attrs
        if (attrs) {
          map.addSource(name, {
            type: 'geojson',
            data: geoPath
          })
        }
        // Add a data source containing GeoJSON data.
        // Add a new layer to visualize the polygon.
        map.addLayer({
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
        map.addLayer({
          'id': `outline-${pathIndex}`,
          'type': 'line',
          'source': name,
          'layout': {},
          'paint': {
            'line-color': '#000',
            'line-width': 1
          }
        });
        map.addLayer({
          'id': `text-${pathIndex}`,
          'type': 'symbol',
          'source': name,
          'layout': {
            'text-field': '{title}'
          }
        });
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
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 1.0 });
      const opList = await page.getOperatorList();
      const svgGfx = new SVGGraphicsOverride(page.commonObjs, page.objs);
      svgGfx.embedFonts = false;

      const svg = await svgGfx.getSVG(opList, viewport);
      // Prepare canvas using PDF page dimensions
      svg.id = "svg-context";
      document.querySelector("#svg-context").replaceWith(svg);

      svgRoot = document.querySelector("#svg-context");
      statePath = findStatePath();
      statePath.path.stroke = "#ff0000"
      // now we have a bounding box for the whole state
      // we also know the true bounding box in latitude and longitude
      // given the position of the state bounding box within the
      // parent bounding box, we can get the lat/long bounding box coordinates
      // of the parent

      // get SVG bounding box

      pathBox = statePath.path.getBoundingClientRect();
      const pathViewBox = statePath.path.getBBox()
      containerBox = statePath.path.ownerSVGElement.getBoundingClientRect();
      const containerViewBox = statePath.path.ownerSVGElement.getBBox()
      pathStateBounds = {
        x: pathBox.left - containerBox.left,
        y: pathBox.top - containerBox.top,
        width: pathBox.width,
        height: pathBox.height
      };

      stateGeo = stateGeos.features.find((f) => {
        const selectedState = document.querySelector("#state-list").value;
        return f.properties.NAME === selectedState;
      });

      //west, south, east, north order.
      const [west, south, east, north] = geojsonExtent(stateGeo);
      geoStateBounds = {
        x: west,
        y: north,
        width: east - west,
        height: south - north
      }

      // compute a transform that produces svg screen from svg view space
      const xViewRatio = pathStateBounds.width / pathViewBox.width
      const yViewRatio = pathStateBounds.height / pathViewBox.height
      screenPointForViewPoint = ({x, y}) => {
        const xViewLeft = x - containerViewBox.x
        const yViewTop = y - containerViewBox.y
        return {
          x: xViewLeft * xViewRatio,
          y: yViewTop * yViewRatio
        }
      }
      viewToScreenBounds = ({x,y,width,height}) => {
        debugger
        const { x: screenX, y: screenY} = screenPointForViewPoint({x,y})
        return {
          x: screenX,
          y: screenY,
          width: width * xViewRatio,
          height: height * yViewRatio
        }
      }


      // compute a transform that produces geo from SVG screen
      /*

      pixelWidth         pixelLeft
      ----------    =   ---------
      geoWidth           geoLeft
      */
      xGeoRatio = geoStateBounds.width / pathStateBounds.width
      yGeoRatio = geoStateBounds.height / pathStateBounds.height
      var geoLeft = pathStateBounds.x * xGeoRatio
      var geoTop = pathStateBounds.y * yGeoRatio
      geoPointForScreenPoint = ({x, y}) => {
        const left = x - containerBox.left
        const top = y - containerBox.top
        return {
          x: left * xGeoRatio + geoLeft,
          y: top * yGeoRatio + geoTop
        }
      }
      screenToGeoBounds = ({x,y,width,height}) => {
        const { x: geoX, y: geoY} = geoPointForScreenPoint({x,y})
        return {
          x: geoX,
          y: geoY,
          width: width * xGeoRatio,
          height: height * yGeoRatio
        }
      }
      var geoContainerWidth = containerBox.width * xGeoRatio
      var geoContainerHeight = containerBox.height * yGeoRatio

      geoContainerTL = {
          x: geoStateBounds.x - geoLeft,
          y: geoStateBounds.y - geoTop
        }
      const geoStateTL = {
        x: geoStateBounds.x,
        y: geoStateBounds.y
      }
      geoContainerTR = {
          x: geoContainerTL.x + geoContainerWidth,
          y: geoStateBounds.y - geoTop
      }
      geoContainerBL = {
          x: geoStateBounds.x - geoLeft,
          y: geoContainerTL.y + geoContainerHeight
      }
      var geoContainerBR = {
          x: geoContainerTL.x + geoContainerWidth,
          y: geoContainerTL.y + geoContainerHeight
      }
      const geoBR = {
        x: geoStateBounds.x + geoStateBounds.width,
        y: geoStateBounds.y + geoStateBounds.height
      }

      const NS = svg.getAttribute('xmlns');
      const aspect = containerBox.weight / containerBox.height
      baseWidth =containerBox.width
      targetHeight =  parseInt(baseWidth * containerBox.height / containerBox.width)


      //var url = `https://maps.googleapis.com/maps/api/staticmap?auto=&scale=2&size=600x300&maptype=roadmap&format=png&key=AIzaSyBEPtIQzAXpTxTkRbGzKuG1p1N7i6g9bAI&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C1%7C${geoContainerTL.y}%2C${geoContainerTL.x}|&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C2%7C${geoContainerBR.y}%2C${geoContainerBR.x}`

      const textPaths = resolveDistrictPaths(svg)
      const geoPaths = Object.entries(textPaths).reduce((result, [districtName, svgPath]) => {

        const districtIndex = Object.keys(textPaths).indexOf(districtName)
        if (districtIndex == 3)
          result[districtName] = {
            svgPath,
            geoPath: geoFeatureForMatch(districtName, svgPath)
          }

        return result
      }, {})
      await showStaticMap()
      await showMap(geoPaths)
    }

    const geoFeatureForMatch = (name, pathElement) => {
      const pathLength = pathElement.getTotalLength();
      const viewBox = pathElement.ownerSVGElement.viewBox.baseVal; // get the viewbox
      const coords = [];

      const isDimensionValid = (dimension) => {
        return dimension !== Infinity && dimension !== NaN
      }

      const mc = document.querySelector('.maps-container')
      const d = new DOMParser()
      
      const pathViewBox = pathElement.getBBox()
      const pathScreenBox = viewToScreenBounds(pathViewBox)
      const pathGeoBox = screenToGeoBounds(pathScreenBox)

    const pathScreenBoxElement = d.parseFromString(`
      <div style="position: absolute; left: ${pathScreenBox.left}px; top: ${pathScreenBox.top}px; width: ${pathScreenBox.width}px; height: ${pathScreenBox.height}px; background-color: rgba(150,100,100,0.3);">${name}</div>
      `, 'text/html')

      mc.appendChild(pathScreenBoxElement.body.children[0])
      for(let i=0; i<pathLength; i+=1) {
        const point = pathElement.getPointAtLength(i);
        const screenPoint = screenPointForViewPoint(point)
        const geoPoint = geoPointForScreenPoint(screenPoint)

        const relativePathGeo = {

        }

        /*

        const pathScreenBox = d.parseFromString(`
        <div style="position: absolute; left: ${pathRect.left - containerBox.left}px; top: ${pathRect.top - containerBox.top}px; width: ${pathRect.width}px; height: ${pathRect.height}px; background-color: rgba(150,100,100,0.3);">${name}</div>
        `, 'text/html')
        mc.appendChild(pathScreenBox.body.children[0])
*/

        console.log({name, pathBox})

        let x = point.x * viewBox.width / containerBox.width + viewBox.x;
        let y = point.y * viewBox.height / containerBox.height + viewBox.y;

        let screenX = x * xGeoRatio + geoContainerTL.x
        let screenY = -y * yGeoRatio + geoContainerTL.y
        
       // y += containerBox.top
        if (isDimensionValid(screenX) && isDimensionValid(screenY)) {
          coords.push({
            x: screenX,
            y: screenY
          })

        }
        


      }
      
    const geometry = {
      type: 'LineString',
      coordinates: coords.map(coord => [coord.x, coord.y])
    };

      const properties = {
        name,
        title: name
      }

      return {
        type: 'Feature',
        geometry,
        properties
      }


    }


    processFiles()

  });

const findStatePath = () => {};
const findParentCoords = () => {};

