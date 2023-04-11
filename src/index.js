//import stateGeos from "./gz_2010_us_040_00_500k.json";
import "./styles.css";
import geojsonExtent from "@mapbox/geojson-extent";
import mapboxGl from 'mapbox-gl'
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
  <input type="submit">

  </p>
  
  
  <canvas id="pdf-canvas"></canvas>
<div class="maps-container">
  <svg id="svg-context"></svg>
  <img id="map-overlay"/>
</div>
  <select id="state-list"></select>
</div>
`;

var stateGeos = { features: [] };
var states = [];
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
      console.log({e})
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
    if (e.name == 'pdfDocument') {
      const candidateState = states.find((state) => filename.includes(state));
      if (candidateState) {
        document.querySelector("select").value = candidateState;
      }

    }
  });
document
  .querySelector("input[type=submit]")
  .addEventListener("click", async () => {
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

    const svgRoot = document.querySelector("#svg-context");
    const pathDimensions = (pathElement) => {
      const clientRect = pathElement.getBBox();
      return {
        clientRect,
        area: clientRect.width * clientRect.height
      };
    };
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
    const statePath = findStatePath();
    // now we have a bounding box for the whole state
    // we also know the true bounding box in latitude and longitude
    // given the position of the state bounding box within the
    // parent bounding box, we can get the lat/long bounding box coordinates
    // of the parent

    // get SVG bounding box
    const pathBox = statePath.path.getBoundingClientRect();
    const containerBox = statePath.path.ownerSVGElement.getBoundingClientRect();
    const pathBounds = {
      x: pathBox.left - containerBox.left,
      y: pathBox.top - containerBox.top,
      width: pathBox.width,
      height: pathBox.height
    };

    const stateGeo = stateGeos.features.find((f) => {
      const selectedState = document.querySelector("#state-list").value;
      return f.properties.NAME === selectedState;
    });

    //west, south, east, north order.
    const [west, south, east, north] = geojsonExtent(stateGeo);
    const geoBounds = {
      x: west,
      y: north,
      width: east - west,
      height: south - north
    }
    // compute a transform that produces geo from SVG
    /*

    pixelWidth         pixelLeft
    ----------    =   ---------
    geoWidth           geoLeft
    */
    const xRatio = geoBounds.width / pathBounds.width
    const yRatio = geoBounds.height / pathBounds.height
    var geoLeft = pathBounds.x * xRatio
    var geoTop = pathBounds.y * yRatio
    var geoContainerWidth = containerBox.width * xRatio

    var geoContainerHeight = containerBox.height * yRatio

    var geoContainerTL = {
        x: geoBounds.x - geoLeft,
        y: geoBounds.y - geoTop
      }
    var ptTL = svg.createSVGPoint()
    ptTL.x = pathBounds.x
    ptTL.y=  pathBounds.y
    const svgTL = ptTL.matrixTransform(svg.getScreenCTM().inverse())
    const geoTL = {
      x: geoBounds.x,
      y: geoBounds.y
    }
    var geoContainerTR = {
        x: geoContainerTL.x + geoContainerWidth,
        y: geoBounds.y - geoTop
    }
    var geoContainerBL = {
        x: geoBounds.x - geoLeft,
        y: geoContainerTL.y + geoContainerHeight
    }
    var geoContainerBR = {
        x: geoContainerTL.x + geoContainerWidth,
        y: geoContainerTL.y + geoContainerHeight
    }
    var ptBR = svg.createSVGPoint()
    ptBR.x = pathBounds.x + pathBounds.width
    ptBR.y = pathBounds.y + pathBounds.height
    const geoBR = {
      x: geoBounds.x + geoBounds.width,
      y: geoBounds.y + geoBounds.height
    }
    const svgBR = ptBR.matrixTransform(svg.getScreenCTM().inverse())
    const NS = svg.getAttribute('xmlns');
    
    const circleTL = document.createElementNS(NS, 'circle');
    circleTL.setAttribute('cx', svgTL.x);
    circleTL.setAttribute('cy', svgTL.y);
    circleTL.setAttribute('r', 10);

    const circleBR = document.createElementNS(NS, 'circle');
    circleBR.setAttribute('cx', svgBR.x);
    circleBR.setAttribute('cy', svgBR.y);
    circleBR.setAttribute('r', 10);
    svg.appendChild(circleTL)
    svg.appendChild(circleBR)


    const aspect = containerBox.weight / containerBox.height
    const baseWidth =containerBox.width
    const targetHeight =  parseInt(baseWidth * containerBox.height / containerBox.width)


    //var url = `https://maps.googleapis.com/maps/api/staticmap?auto=&scale=2&size=600x300&maptype=roadmap&format=png&key=AIzaSyBEPtIQzAXpTxTkRbGzKuG1p1N7i6g9bAI&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C1%7C${geoContainerTL.y}%2C${geoContainerTL.x}|&markers=size:mid%7Ccolor:0x2e3a5c%7Clabel:C2%7C${geoContainerBR.y}%2C${geoContainerBR.x}`
    var url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/[${geoContainerBL.x},${geoContainerBL.y},${geoContainerTR.x},${geoContainerTR.y}]/${baseWidth}x${targetHeight}?access_token=pk.eyJ1IjoidGFzdHljb2RlMiIsImEiOiJjbGdiNHdnOGEwb28wM2pxcDB6amtrN3kwIn0.zuXHfjoFOj73cV_ni3t3UA`
    document.querySelector('#map-overlay').setAttribute('src', url)
    // now we pass in the lat/longs to the SVG as meta elements

    // pass into svg2geojson library
    function removeNameSpace (root){    
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
        <GeoItem X="${svgTL.x}" Y="${svgTL.y}" Latitude="${geoTL.y}" Longitude="${geoTL.x}"/>
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
      const geoX = transformed.x * xRatio
      const geoY = transformed.y * yRatio
      return [geoContainerTL.x + geoX, geoContainerTL.y + geoY]
    }
    const pathToSvgCoords = (svgPathElement) => {
      const pathCommands = svgPathElement.attributes['d'].value.split(/(?=[MLC])/);
      const coordinates = [];

      pathCommands.forEach((command) => {
        const type = command[0];
        const args = command.substring(1).split(/[ ,]/).map(Number);

        switch (type) {
          case "M":
          case "L":
            coordinates.push([args[0], args[1]]);
            break;
          case "C":
            for (let i = 0; i < args.length; i += 6) {
              coordinates.push([args[i + 4], args[i + 5]]);
            }
            break;
          default:
            break;
        }
      });
      return coordinates
    }

    const geoFeatureForMatch = (name, svgPath) => {
      const coords = pathToSvgCoords(svgPath)
      const geoCoords = coords.map(([x,y]) => translateSvgCoordinate(x,y))
      const feature = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: geoCoords
        },
        properties: {
          districtName: name
        },
      }
      return feature
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
              if (text === 'Craighead EC' && currentPath.attributes['d'].value.length === 19357) {
                debugger
              }

            return result
          }),
          R.sortBy(path => {
            // what is the overlap between this path's bounding box and the candidate path?
            const pathBox = path.getBoundingClientRect()
            const overX = Math.min(0, textBox.x + textBox.width - pathBox.x + pathBox.width)
            const overY = Math.min(0, textBox.y +  textBox.height - pathBox.y + pathBox.height)
            const underX = Math.min(pathBox.x - textBox.x, 0)
            const underY = Math.min(pathBox.y - textBox.y, 0)
            const total = overX + overY + underX + underY
            return total
          })
        )(inStatePaths)
        const textContainedPath = polyPaths.at(-1)
        

        // since we don't have anything to bind the lines of each district together until this point
        // we can use the fact that the lines of text inside the district's text elements all resolve
        // to the same element
        if (textContainedPath) {
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




      /*
      return {
        "Elmwood EC": <path ..../>
      }
      */
    }
    const textPaths = resolveDistrictPaths(svg)
    const geoPaths = Object.entries(textPaths).reduce((result, [districtName, svgPath]) => {

      result[districtName] = {
        svgPath,
        geoPath: geoFeatureForMatch(districtName, svgPath)
      }

      return result
    }, {})
    debugger



    geoFromSVGXML(prepareSVG(svg), (layer) => {
      console.log('found layer', layer);
    })
    


    // then call svg2geojson to convert the
  });

const findStatePath = () => {};
const findParentCoords = () => {};

