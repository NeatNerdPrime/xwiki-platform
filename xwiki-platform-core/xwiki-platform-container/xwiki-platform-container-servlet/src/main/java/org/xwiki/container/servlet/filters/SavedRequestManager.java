/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
package org.xwiki.container.servlet.filters;

import java.io.Serializable;
import java.util.HashMap;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import org.apache.commons.lang3.RandomStringUtils;
import org.apache.commons.lang3.StringUtils;
import org.xwiki.jakartabridge.servlet.JakartaServletBridge;
import org.xwiki.stability.Unstable;

/**
 * Allows to save a request and restore it later from the stored request identifier (SRID).
 * 
 * @version $Id$
 * @since 2.5M1
 */
public final class SavedRequestManager
{
    /** The name of the parameter used for identifying a saved request in a new request. */
    private static final String SAVED_REQUESTS_IDENTIFIER = "srid";

    /** The key used for storing request data in the HTTP session. */
    private static final String SAVED_REQUESTS_KEY = SavedRequest.class.getCanonicalName() + "_SavedRequests";

    /**
     * Saved request data. Only request parameter are stored, along with the requested URL.
     */
    public static class SavedRequest implements Serializable
    {
        /** Unique serialization identifier. */
        private static final long serialVersionUID = 8779129900717599986L;

        /** Saved request data. */
        private Map<String, String[]> parameters;

        /**
         * The request URL; does not include the query string. The data is reused only if the new URL matches this
         * value.
         */
        private String requestUrl;

        /**
         * Constructor that copies the needed information from a request.
         * 
         * @param request the request that needs to be saved
         * @deprecated use {@link #SavedRequest(HttpServletRequest)}) instead
         */
        @Deprecated(since = "17.0.0RC1")
        public SavedRequest(javax.servlet.http.HttpServletRequest request)
        {
            this(JakartaServletBridge.toJakarta(request));
        }

        /**
         * Constructor that copies the needed information from a request.
         * 
         * @param request the request that needs to be saved
         * @since 17.0.0RC1
         */
        @Unstable
        public SavedRequest(HttpServletRequest request)
        {
            this.parameters = new HashMap<>(request.getParameterMap());
            this.requestUrl = request.getRequestURL().toString();
        }

        /**
         * Gets the value for a parameter, just like {@link jakarta.servlet.ServletRequest#getParameter(String)}.
         * 
         * @param name the name of the parameter
         * @return The first value for this parameter, or <code>null</code> if no value was sent for this parameter.
         * @see jakarta.servlet.ServletRequest#getParameter(String)
         * @see #getParameterValues(String)
         */
        public String getParameter(String name)
        {
            String[] values = this.parameters.get(name);
            if (values != null && values.length > 0) {
                return values[0];
            }
            return null;
        }

        /**
         * Gets all the values stored for a parameter, just like
         * {@link jakarta.servlet.ServletRequest#getParameterValues(String)}.
         * 
         * @param name the name of the parameter
         * @return All the values for this parameter, or <code>null</code> if no value was sent for this parameter.
         * @see jakarta.servlet.ServletRequest#getParameterValues(String)
         * @see #getParameter(String)
         */
        public String[] getParameterValues(String name)
        {
            return this.parameters.get(name);
        }

        /**
         * Gets all the stored parameters, just like {@link jakarta.servlet.ServletRequest#getParameterMap()}.
         * 
         * @return A map with all the stored parameters.
         * @see jakarta.servlet.ServletRequest#getParameterMap()
         */
        public Map<String, String[]> getParameterMap()
        {
            return this.parameters;
        }

        /**
         * Retrieves the original URL used for this request, as a future request will be able to reuse this data only if
         * it is for the same document. Does not contain the query string.
         * 
         * @return A <code>String</code> representation of the URL corresponding to this request.
         */
        public String getRequestUrl()
        {
            return this.requestUrl;
        }
    }

    /**
     * Forbid instantiation {@link SavedRequestManager}.
     */
    private SavedRequestManager()
    {
    }

    /**
     * @return the SAVED_REQUESTS_IDENTIFIER
     */
    public static String getSavedRequestIdentifier()
    {
        return SAVED_REQUESTS_IDENTIFIER;
    }

    /**
     * @return the SAVED_REQUESTS_KEY
     */
    public static String getSavedRequestKey()
    {
        return SAVED_REQUESTS_KEY;
    }

    /**
     * Saves the data from a request and stores it in the current session. This method is not thread safe, and does not
     * guarantee that saved requests are not overwritten, but given that this should only happen sparingly, and that
     * each client uses his own session to save this kind of information, this is not a real issue.
     * 
     * @param request the request to save
     * @return the identifier of the saved request
     * @deprecated use {@link #saveRequest(HttpServletRequest)} instead
     */
    @Deprecated(since = "17.0.0RC1")
    public static String saveRequest(javax.servlet.http.HttpServletRequest request)
    {
        return saveRequest(JakartaServletBridge.toJakarta(request));
    }

    /**
     * Saves the data from a request and stores it in the current session. This method is not thread safe, and does not
     * guarantee that saved requests are not overwritten, but given that this should only happen sparingly, and that
     * each client uses his own session to save this kind of information, this is not a real issue.
     * 
     * @param request the request to save
     * @return the identifier of the saved request
     * @since 17.0.0RC1
     */
    @Unstable
    @SuppressWarnings("unchecked")
    public static String saveRequest(HttpServletRequest request)
    {
        // Saved requests are stored in the request session
        HttpSession session = request.getSession();
        // Retrieve (and eventually initialize) the list of stored requests
        Map<String, SavedRequest> savedRequests =
            (Map<String, SavedRequest>) session.getAttribute(getSavedRequestKey());
        if (savedRequests == null) {
            savedRequests = new HashMap<>();
            session.setAttribute(getSavedRequestKey(), savedRequests);
        }
        // Save the request data
        SavedRequest savedRequest = new SavedRequest(request);
        // Generate a random key to identify this request
        String key;
        do {
            key = RandomStringUtils.secure().nextAlphanumeric(8);
        } while (savedRequests.containsKey(key));
        // Store the saved request
        savedRequests.put(key, savedRequest);
        // Return the generated identifier
        return key;
    }

    /**
     * Retrieves the original URL requested before a detour. This method returns something different from
     * <code>null</code> only when there's a <em>srid</em> parameter in the current request, indicating that there was
     * another request which data was saved, related to the current request.
     * 
     * @param request the current request
     * @return the original requested URL that triggered a detour, or <code>null</code> if there isn't any original
     *         request information
     * @deprecated use {@link #getOriginalUrl(HttpServletRequest)} instead
     */
    @Deprecated(since = "17.0.0RC1")
    public static String getOriginalUrl(javax.servlet.http.HttpServletRequest request)
    {
        return getOriginalUrl(JakartaServletBridge.toJakarta(request));
    }

    /**
     * Retrieves the original URL requested before a detour. This method returns something different from
     * <code>null</code> only when there's a <em>srid</em> parameter in the current request, indicating that there was
     * another request which data was saved, related to the current request.
     * 
     * @param request the current request
     * @return the original requested URL that triggered a detour, or <code>null</code> if there isn't any original
     *         request information
     * @since 17.0.0RC1
     */
    @Unstable
    @SuppressWarnings("unchecked")
    public static String getOriginalUrl(HttpServletRequest request)
    {
        HttpSession session = request.getSession();
        Map<String, SavedRequest> savedRequests =
            (Map<String, SavedRequest>) session.getAttribute(getSavedRequestKey());
        if (savedRequests != null) {
            String identifier = request.getParameter(getSavedRequestIdentifier());
            if (!StringUtils.isEmpty(identifier)) {
                SavedRequest savedRequest = savedRequests.get(request.getParameter(getSavedRequestIdentifier()));
                if (savedRequest != null) {
                    return savedRequest.getRequestUrl() + "?srid=" + identifier;
                }
            }
        }
        return null;
    }
}
