#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiUDP.h>
#include <Ticker.h>
#include <ctime>
#include <i2s.h>
#include <i2s_reg.h>
#include <include/slist.h>  // warning only useful for singleton lists

#include "adsr.h"

static const char* s_ssid = "Tortellini";
static const char* s_password = "Bainbridge";
static const char* s_quakeServerName = "earthquake.usgs.gov";
static const char *s_ntpServerName = "time.nist.gov";
static IPAddress s_quakeServerIP, s_ntpServerIP;
#define HTTPS_PORT 443
#define NTP_PORT 123

static const char* s_fingerprint = "6f c6 df be 20 c9 be ab 60 28 30 85 ec 4f eb 0a 56 7a 24 91";
WiFiUDP s_ntpClient;
WiFiServer s_httpServer(80);

enum pins
{
    k_LED_PIN = LED_BUILTIN, // 2
    k_SOUND_PIN = 3, // I2SO_DATA
    k_BUTTON_PIN = D1, // Arduino PIN 12 is D6
    k_SOUND_CLK = 15,   // I2SO_BCK (SCLK) (unused)
};

static void httpResponse(String &request, WiFiClient &);

static Ticker s_quakeTicker;
#define QUAKECHECK_INTERVAL_SEC 180.
static void quakeAlarm();
static void detectQuakes();
static void simulateQuake(float mag);
static bool insertQuakeIfNew(class Quake const &);
static volatile bool s_checkForQuakes = true; // first is startup

#define TIMEZONE_OFFSET -7
static Ticker s_ntpTicker;
static String s_localTime;
static struct tm s_currentTime;
#define NTPCHECK_INTERVAL_SEC 5*60 // five minutes
static volatile enum
{
    k_idleTime,
    k_requestTime,
    k_awaitTime
} s_checkTime = k_requestTime;
static void ntpAlarm();
static void requestTime();
static bool receiveTime();

static Ticker s_ledTicker;
static volatile bool s_toggleLED = false;
#define LEDCHECK_INTERVAL_SEC 1
static void ledAlarm();

static bool s_soundEnabled = false; // wait for ntp check to enable
static void soundInit();
static void sendSound();
static void playRumble(struct Quake const &);
static void writeDAC(uint16_t DAC);
static int16_t inoise16_raw(uint32_t x); /* input 16.16 (-18k,18k) */
static inline uint16_t inoise16(uint32_t x)
{
  return ((uint32_t)((int32_t)inoise16_raw(x) + 17308L)) << 1;
}

/*--------------------------------------------------------------------------*/
void setup()
{
    pinMode(LED_BUILTIN, OUTPUT);
    digitalWrite(LED_BUILTIN, LOW); // LOW is on
    pinMode(k_BUTTON_PIN, INPUT_PULLUP); // INPUT_PULLUP);

    Serial.begin(115200);
    Serial.println();
    Serial.print("Connecting to internet access point ");
    Serial.println(s_ssid);
    WiFi.mode(WIFI_STA); // WIFI_AP is used to establish name & password to router
                         // WIFI_STA means: knows a router to connect to
                         // we can run a server on either class of node
    WiFi.begin(s_ssid, s_password);
    delay(100);
    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }
    Serial.println("");
    Serial.println("WiFi connected");
    Serial.println("IP address: ");
    Serial.println(WiFi.localIP());

    if(!WiFi.hostByName(s_quakeServerName, s_quakeServerIP))
        Serial.println("DNS lookup failure (quake)");

    if(!WiFi.hostByName(s_ntpServerName, s_ntpServerIP))
        Serial.println("DNS lookup failure (ntp)");

    Serial.println("Starting ntp client");
    s_ntpClient.begin(NTP_PORT);

    Serial.println("Starting http server");
    s_httpServer.begin();

    soundInit();

    s_ledTicker.attach(LEDCHECK_INTERVAL_SEC, ledAlarm);
    s_quakeTicker.attach(QUAKECHECK_INTERVAL_SEC, quakeAlarm);
    s_ntpTicker.attach(NTPCHECK_INTERVAL_SEC, ntpAlarm);

    digitalWrite(LED_BUILTIN, HIGH); // LED off
}

void loop()
{
    static int s_buttonDown = 0;
    static unsigned long s_buttonTimer;
    if(s_httpServer.hasClient())
    {
        Serial.println("hasClient");
        WiFiClient httpClient = s_httpServer.available();
        delay(10);
        Serial.println("http request:");
        String request = httpClient.readStringUntil('\r');
        Serial.print(" ");
        Serial.println(request);
        httpClient.flush();
        httpResponse(request, httpClient);
    }
    if(s_checkForQuakes)
    {
        detectQuakes();
        s_checkForQuakes = false;
    }
    if(s_toggleLED)
    {
        int state = digitalRead(LED_BUILTIN);
        digitalWrite(LED_BUILTIN, !state);
        s_toggleLED = false;

        // occasionally we are asked to receive the time
        if(s_checkTime == k_awaitTime)
        {
            if(receiveTime())
                s_checkTime = k_idleTime;
        }
    }
    if(s_checkTime == k_requestTime)
    {
        requestTime();
        s_checkTime = k_awaitTime; // we check for response in the led toggle event
    }

    if(digitalRead(k_BUTTON_PIN)) // HIGH is released (INPUT_PULLUP)
    {
        if(s_buttonDown > 5)
        {
            // Serial.println("up ---------------------");
            float mag = (millis() - s_buttonTimer) / 1000.0;
            simulateQuake(mag);
        }
        s_buttonDown = 0;
    }
    else
    {
        if(s_buttonDown == 0)
        {
            // Serial.println("down --------------------");
            s_buttonTimer = millis();
        }
        s_buttonDown++;
    }
    sendSound();
}
/*------------------------------------------------------------------------*/
#define QUAKELIST_LEN 40 // sized according to max quakes to keep around

static uint8_t s_nextQuake=0; // circular index into s_recentQuakes

struct Quake
{
    String id;
    struct tm time;
    float magnitude;
    String place;
    float latitude;
    float longitude;

    int operator==(Quake const &rhs) const
    {
        return id == rhs.id;
    }

    void presentHtml(WiFiClient &client)
    {
        char buf[255];
        snprintf(buf, 255, "<tr><td>%02d:%02d</td>",
                (24+this->time.tm_hour+TIMEZONE_OFFSET)%24, this->time.tm_min);
        client.println(buf);

        snprintf(buf, 255, "<td>%3.1f</td>", this->magnitude); // TODO highlight
        client.println(buf);

        // http://www.google.com/maps/place/49.46,17.11/@49.46,17.11,7z
        snprintf(buf, 255, "<td><a target=\"_blank\" "
                "href=\"http://www.google.com/maps/place/%5.2f,%5.2f/@%f,%f,8z\">%s</a>"
                "</td></tr>",
                this->latitude, this->longitude,
                this->latitude, this->longitude,
                this->place.c_str());
        client.println(buf);
    }

    void print(char const *xtra=NULL) const
    {
        char buf[255];
        snprintf(buf, 255, "%02d:%02d %-30.30s mag: %3.1f (%3.1f, %3.1f) %s",
                (24+this->time.tm_hour+TIMEZONE_OFFSET)%24, this->time.tm_min,
                this->place.c_str(), this->magnitude,
                this->latitude, this->longitude, xtra ? xtra : "");
        Serial.println(buf);
    }

    void parse(String const &line)
    {
        // https://earthquake.usgs.gov/data/comcat/data-eventterms.php
        //
        // 2017-10-05T18:01:34.660Z,33.5108333,-116.7906667,6.63,0.47,ml,23,
        // 94,0.07035,0.12,ci,ci38019760,2017-10-05T18:18:31.144Z,
        // "10km NE of Aguanga, CA",earthquake,0.18,0.39,0.168,11,reviewed,ci,ci
        //
        // time,latitude,longitude,depth,mag,magType,nst,gap,dmin,rms,net,id,updated,
        //    place,type,horizontalError,depthError,magError,magNst,status,
        //    locationSource,magSource
        //

        // to get to our local time zone (time and date must be modified).
        char const *str = line.c_str();
        char *field = strptime(str, "%Y-%m-%dT%T.", &this->time);
        field = index(field, ',') + 1;
        this->latitude = strtof(field, &field);
        field = index(field, ',') + 1;
        this->longitude = strtof(field, &field);
        field = index(field, ',') + 1; // depth
        field = index(field, ',') + 1; // mag
        this->magnitude = strtof(field, &field);
        field = index(field, ',')+1; // magType
        field = index(field, ',')+1; // nst
        field = index(field, ',')+1; // gap
        field = index(field, ',')+1; // dmin
        field = index(field, ',')+1; // rms
        field = index(field, ',')+1; // net
        field = index(field, ',')+1; // id
        this->id = line.substring(field - str, index(field, ',')-str);
        field = index(field, ',')+1; // updated
        field = index(field, ',')+1; // place
        // place name has quotes to allow embedded comma
        this->place = line.substring(field-str+1, index(field+1, '"')-str);
    }
};

static Quake s_recentQuakes[QUAKELIST_LEN];

static void quakeAlarm()
{
    s_checkForQuakes = true;
}

static void detectQuakes()
{
    static String s_quakeQueryURL;
    if(s_quakeQueryURL.length() == 0)
    {
        s_quakeQueryURL.concat(
            "GET /earthquakes/feed/v1.0/summary/all_hour.csv "
            " HTTP/1.1\r\n"
            "Host: ");
        s_quakeQueryURL.concat(s_quakeServerName);
        s_quakeQueryURL.concat("\r\n"
               "User-Agent: Rumbler-CanneryCoders\r\n"
               "Connection: close\r\n\r\n");
    }

    // Use WiFiClientSecure class to create TLS connection
    WiFiClientSecure client; // earthquake.usgs.gov only works on 443/ClientSecure
    Serial.print("Connecting to ");
    Serial.println(s_quakeServerName);
    if (!client.connect(s_quakeServerIP, HTTPS_PORT))
    {
        Serial.println("Connection failed");
        return;
    }
    if (!client.verify(s_fingerprint, s_quakeServerName))
    {
        Serial.println("certificate doesn't match");
    }
    client.print(s_quakeQueryURL);
    while (client.connected())
    {
        String hdr = client.readStringUntil('\n');
        if (hdr == "\r")
        {
            // Serial.println("headers received");
            break;
        }
    }
    String fmt = client.readStringUntil('\n');
    //Serial.println(fmt);
    Serial.println("-----");

    String line;
    Quake q;
    bool found = false;
    while(client.available())
    {
        line = client.readStringUntil('\n'); // was readStringUntil;
        q.parse(line);
        if(insertQuakeIfNew(q))
        {
            found = true;
            playRumble(q);
        }
    }
    if(!found)
        Serial.println("  (no new quakes)");
    Serial.println("-----");
    client.stop();

    // s_quakeTicker.attach(QUAKECHECK_INTERVAL_SEC, detectQuakes);
}

static bool insertQuakeIfNew(Quake const &q)
{
    for(int i=0;i<QUAKELIST_LEN;i++)
    {
        if(s_recentQuakes[i].id == q.id)
            return false;
    }
    s_recentQuakes[s_nextQuake] = q;
    s_nextQuake = (s_nextQuake + 1) % QUAKELIST_LEN;

    return true;
}

static void simulateQuake(float mag)
{
    static int count = 7; // just cuz 0 produces negative hours
    Quake q;
    q.id = "<simulated>";
    q.place = q.id;
    q.magnitude = mag;
    q.time.tm_hour = count++;
    q.time.tm_min = 0;
    playRumble(q);
}

/*------------------------------------------------------------------------*/
static void httpResponse(String &request, WiFiClient &client)
{
    if(request.startsWith("GET /favicon.ico"))
    {
        client.println("HTTP/1.1 404 Not Found");
    }
    else
    {
        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: text/html");
        client.println(""); // do not forget this line
        client.println("<!DOCTYPE HTML>");
        client.println("<head>");
        client.println("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        client.println("</head>");
        client.println("<html>");
        client.println("<h3>Recent Quakes <small>as of ");
        client.println(s_localTime);
        client.println("</small></h3>");
        client.println("<table id=\"Quaketab\" border=\"0\" width=\"560\" cellspacing=\"5\">");
        client.println("<tr>"
                            "<th align='left' onclick=\"sortTable(0)\">When</th> "
                            "<th align='left' onclick=\"sortTable(1)\">Mag</th>"
                            "<th align='left'>Epicenter</th>"
                        "</tr>");
        for(int i=0;i<QUAKELIST_LEN;i++)
        {
            int offset = (s_nextQuake-1-i+QUAKELIST_LEN) % QUAKELIST_LEN; // newest first
            Quake &q = s_recentQuakes[offset];
            if(q.id.length() > 0)
                q.presentHtml(client);
        }
        client.println("</table>");
        client.println("<script>");
        client.println(
"function sortTable(col) {"
"  var table = document.getElementById('Quaketab');"
"  var rows, i, x, y, shouldSwitch, dir;"
"  var switching = true;"
"  var switchcount = 0;"
"  var dir = 'asc';"
"  while (switching) {"
"    switching = false;"
"    rows = table.getElementsByTagName('TR');"
"    for (i = 1; i < (rows.length - 1); i++) {"
"      shouldSwitch = false;"
"      x = rows[i].getElementsByTagName('TD')[col];"
"      y = rows[i + 1].getElementsByTagName('TD')[col];"
"      if (dir == 'asc') {"
"        if (x.innerHTML.toLowerCase() > y.innerHTML.toLowerCase()) {"
"          shouldSwitch= true;"
"          break;"
"        }"
"      } else if (dir == 'desc') {"
"        if (x.innerHTML.toLowerCase() < y.innerHTML.toLowerCase()) {"
"          shouldSwitch = true;"
"          break;"
"        }"
"      }"
"    }"
"    if (shouldSwitch) {"
"      rows[i].parentNode.insertBefore(rows[i+1], rows[i]);"
"      switching = true;"
"      switchcount ++; "
"    } else {"
"      /* If no switching has been done AND the direction is 'asc',"
"      set the direction to 'desc' and run the while loop again. */"
"      if (switchcount == 0 && dir == 'asc') {"
"        dir = 'desc';"
"        switching = true;"
"      }"
"    }"
"  }"
"}");
        client.println("</script>");
        client.println("</html>");
    }
}


/*------------------------------------------------------------------------- */
static void ledAlarm()
{
    s_toggleLED = true;
}

/*------------------------------------------------------------------------- */
#define NTP_PACKET_SIZE 48
static uint8_t s_ntpBuffer[NTP_PACKET_SIZE];
static void ntpAlarm()
{
    s_checkTime = k_requestTime;
}

static void requestTime()
{
    memset(s_ntpBuffer, 0, NTP_PACKET_SIZE);
    s_ntpBuffer[0] = 0xE3; // LI, Version, Mode
    s_ntpClient.beginPacket(s_ntpServerIP, NTP_PORT);
    s_ntpClient.write(s_ntpBuffer, NTP_PACKET_SIZE);
    s_ntpClient.endPacket();
}

static bool receiveTime()
{
    if(s_ntpClient.parsePacket() == 0)
        return false;
    s_ntpClient.read(s_ntpBuffer, NTP_PACKET_SIZE);

    uint32_t ntpTime = (s_ntpBuffer[40] << 24) | (s_ntpBuffer[41] << 16) |
               (s_ntpBuffer[42] << 8) | s_ntpBuffer[43];


    char buf[80];
    s_currentTime.tm_hour = ((ntpTime / 3600) + TIMEZONE_OFFSET) % 24;
    s_currentTime.tm_min = (ntpTime / 60) % 60;
    s_currentTime.tm_sec = ntpTime % 60;

    if(s_currentTime.tm_hour < 8 || s_currentTime.tm_hour >= 21)
    {
        if(s_soundEnabled)
        {
            s_soundEnabled = false;
            Serial.println("disabling sound");
        }
    }
    else
    if(!s_soundEnabled)
    {
        s_soundEnabled = true;
        Serial.println("enabling sound");
    }
    snprintf(buf, 80, "%02d:%02d:%02d",
            s_currentTime.tm_hour, s_currentTime.tm_min, s_currentTime.tm_sec);
    s_localTime = buf;
    snprintf(buf, 80, "current time: %s %s",
            s_localTime.c_str(),
            s_soundEnabled ? "<on>" : "<silent>");
    Serial.println(buf);
    return true;
}

/*------------------------------------------------------------------------*/
// from https://janostman.wordpress.com/audio-hacking-with-the-esp8266/
// Pulse Density Modulated 16-bit I2S DAC
#define k_maxNotes 2
struct note
{
    uint16_t style; // 0 means none
    uint16_t amp;
    uint32_t phase;
    float mag;
    ADSR adsr;

    void init(float inmag)
    {
        this->mag = inmag;
        this->style = 1 + static_cast<int>(inmag);
        this->phase = 0;
        this->amp = (inmag >= 6) ? 50000 :
                    ((inmag > 4) ? 40000 : 30000);
        this->adsr.init();
    }

} s_notes[k_maxNotes];

static uint16_t s_sine[256]; // normalized zine [0, 65536]

static void soundInit()
{
    i2s_begin();
    // internally calls
    //  - i2s_set_rate(44100);
    // - pinMode(2, FUNCTION_1) // I2SO_WS LRCK
    // - pinMode(3, FUNCTION_1) // I2SO_DATA
    // - pinMode(15, FUNCTION_1) // I2SO_BCK (SCLK)
    i2s_set_rate(22050); // 44100); // 22050);
    // we're only using a single pin (3)
    // so the following "resets" unused pins to default config
     pinMode(2, OUTPUT); // to restore led functionality (ex uses INPUT)
     pinMode(15, INPUT);

     for(int i=0;i<256;i++)
     {
        s_sine[i] = 32727 * (1. + sin( 2.0 * 3.14159265 * i / 256));
     }

    for(int i=0;i<k_maxNotes;i++)
         s_notes[i].style = 0; // OFF
}

static void playRumble(struct Quake const &q)
{
    char const *msg = nullptr;
    char buf[64];

    float minMag = 10;
    int minSlot = -1;
    // first fill empty slot, if no slots are empty, kick out the lowest mag
    for(int i=0;i<k_maxNotes;i++)
    {
        note &n = s_notes[i];
        if(n.style == 0) // empty slot
        {
            n.init(q.magnitude);
            sprintf(buf, " vol: %0.2f (%d)", n.amp / 65535.f, n.style);
            msg = buf;
            break;
        }
        else
        if(q.magnitude > n.mag && n.mag < minMag)
        {
            minSlot = i;
            minMag = n.mag;
        }
    }
    if(!msg && minSlot != -1)
    {
        // no slots available
        note &n = s_notes[minSlot];
        n.init(q.magnitude);
        sprintf(buf, " vol: %0.2f (%d) +", n.amp / 65535.f, n.style);
        msg = buf;
    }
    q.print( msg ? msg : " (silent)");
}

static void sendSound()
{
    uint16_t sample = 0;
    for(int i=0;i<k_maxNotes;i++)
    {
        note &n = s_notes[i];
        uint32_t t = n.phase++ / 2; // n.phase is around 80 hz, n.phase/2 is 40
        uint32_t psamp; // is 16.16 to convert to 0.16
        uint16_t tmod; // base freq
        switch(n.style)
        {
        case 0: // off
            psamp = 0;
            break;
        case 1: // [1,1.99] // pure sine
            psamp = s_sine[0xff & t]; // 16 bit samples
            break;
        case 2: // [2, 2.99] // two octaves of sine
            psamp = s_sine[0xff & t] >> 1;
            psamp += s_sine[0xff & (2*t)] >> 1;
            break;
        case 3: // [3, 3.99] triangle plus sin
            psamp = s_sine[t&0xff];
            tmod = 0x1ff & (t*4);
            if(tmod > 255) tmod = 512 - tmod;
            psamp += 128 * tmod; // 9 bit to 16 bit
            break;
        case 4: // [4, 4.99] // square wave 50% duty cycle
            psamp = s_sine[0xff & t] >> 1;
            psamp += s_sine[0xff & t] < 32767 ? 0 : 32768;
            break;
        case 5: // [5, 5.99] // sawtoooth plus sin
            psamp = s_sine[0xff & t] >> 1;
            psamp += 128 * (0xff & (t*2)); // sawtooth
            break;
        case 6: // [6, 6.99]
            psamp = s_sine[0xff & t]; // sin*unwrapped sawtoth weirdly cool
            psamp = psamp * t >> 16;
            break;
        case 7: // [7, 7.99]
            psamp = inoise16(t << 10); // 10 is reasonable, 9 is clicky
            psamp += s_sine[0xff&t] >> 1;
            break;
        case 8: // [8, 8.99]
        case 9: // [9, 9.99]
        default:
            psamp = inoise16(t << 12); // 10 is reasonable, 9 is clicky
            psamp += s_sine[0xff&t] >> 1;
            break;
        }
        if(n.style != 0)
        {
            // per-tone volume
            psamp = (psamp * n.amp) >> 16;
            psamp = n.adsr.apply(psamp);
            if(n.adsr.getState() == ADSR::k_idle)
            {
                Serial.print(i);
                Serial.print(" end, style:");
                Serial.println(n.style);
                n.style = 0; // done with note! OFF
            }
            sample += psamp;
        }
    }
    if(!s_soundEnabled) // disabled here since we want standard lifecycle
                        // to terminate/release the note
        sample = 0;
    writeDAC(sample);
}

// This function generates 16-bit samples by Delta-Sigma coding the bits.
//  - write_sample purports to write stereo 16 bits/channel, but our
//   hardware "decoder" is mono.
// - write_sample blocks when the dma buffer is full. return code is
//   always true (and thus not very useful).
// - i2s_is_full() can be used to check whether we'd block
static void writeDAC(uint16_t val)
{
    static uint32_t i2sACC = 0;
    static uint16_t err = 0;
    for (uint8_t i=0;i<32;i++)
    {
        i2sACC = i2sACC<<1;
        if(val >= err)
        {
            i2sACC |= 1;
            err += 0xFFFF - val;
        }
        else
        {
            err -= val;
        }
    }
    i2s_write_sample(i2sACC);
}

/* -------------------------------------------------------------*/
// From FastLED project
#define FL_PGM_READ_BYTE_NEAR(x)  (*((const  uint8_t*)(x)))
#define P(x) FL_PGM_READ_BYTE_NEAR(p + x)
#define FADE(x) scale16(x, x)
#define LERP(a, b, u) lerp15by16(a,b,u)
#define AVG15(U, V)  avg15(U, V);
typedef uint16_t fract16;

static uint8_t const p[] =
{
   151,160,137,91,90,15,
   131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
   190, 6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,
   88,237,149,56,87,174,20,125,136,171,168, 68,175,74,165,71,134,139,48,27,166,
   77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,
   102,143,54, 65,25,63,161, 1,216,80,73,209,76,132,187,208, 89,18,169,200,196,
   135,130,116,188,159,86,164,100,109,198,173,186, 3,64,52,217,226,250,124,123,
   5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,
   223,183,170,213,119,248,152, 2,44,154,163, 70,221,153,101,155,167, 43,172,9,
   129,22,39,253, 19,98,108,110,79,113,224,232,178,185, 112,104,218,246,97,228,
   251,34,242,193,238,210,144,12,191,179,162,241, 81,51,145,235,249,14,239,107,
   49,192,214, 31,181,199,106,157,184, 84,204,176,115,121,50,45,127, 4,150,254,
   138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,151
};

/// Calculate an integer average of two signed 15-bit
///       integers (int16_t)
///       If the first argument is even, result is rounded down.
///       If the first argument is odd, result is result up.
static int16_t inline __attribute__((always_inline))
avg15( int16_t i, int16_t j)
{
    return ((int32_t)((int32_t)(i) + (int32_t)(j)) >> 1) + (i & 0x1);
}

static uint16_t inline __attribute__((always_inline))
scale16(uint16_t i, fract16 scale)
{
    return ((uint32_t)(i) * (1+(uint32_t)(scale))) / 65536;
}

/// linear interpolation between two signed 15-bit values,
/// with 8-bit fraction
static int16_t
lerp15by16( int16_t a, int16_t b, fract16 frac)
{
    int16_t result;
    if( b > a)
    {
        uint16_t delta = b - a;
        uint16_t scaled = scale16( delta, frac);
        result = a + scaled;
    }
    else
    {
        uint16_t delta = a - b;
        uint16_t scaled = scale16( delta, frac);
        result = a - scaled;
    }
    return result;
}

static int16_t inline __attribute__((always_inline))
grad16(uint8_t hash, int16_t x)
{
    hash = hash & 15;
    int16_t u,v;
    if(hash > 8) { u=x;v=x; }
    else if(hash < 4) { u=x;v=1; }
    else { u=1;v=x; }
    if(hash&1) { u = -u; }
    if(hash&2) { v = -v; }
    return AVG15(u,v);
}

static int16_t inoise16_raw(uint32_t x)
{
  // Find the unit cube containing the point
  uint8_t X = x>>16;

  // Hash cube corner coordinates
  uint8_t A = P(X);
  uint8_t AA = P(A);
  uint8_t B = P(X+1);
  uint8_t BA = P(B);

  // Get the relative position of the point in the cube
  uint16_t u = x & 0xFFFF;

  // Get a signed version of the above for the grad function
  int16_t xx = (u >> 1) & 0x7FFF;
  uint16_t N = 0x8000L;

  u = FADE(u);

  int16_t ans = LERP(grad16(P(AA), xx), grad16(P(BA), xx - N), u);

  return ans;
}
