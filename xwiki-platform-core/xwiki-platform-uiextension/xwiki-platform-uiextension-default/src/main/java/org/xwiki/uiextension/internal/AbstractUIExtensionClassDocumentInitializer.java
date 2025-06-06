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
package org.xwiki.uiextension.internal;

import org.xwiki.model.reference.EntityReference;

import com.xpn.xwiki.internal.mandatory.AbstractAsyncClassDocumentInitializer;
import com.xpn.xwiki.objects.classes.BaseClass;
import com.xpn.xwiki.objects.classes.TextAreaClass.EditorType;

/**
 * Base class to initialize xclass for various implementations of UI extensions.
 *
 * @version $Id$
 * @since 10.10RC1
 */
public abstract class AbstractUIExtensionClassDocumentInitializer extends AbstractAsyncClassDocumentInitializer
    implements WikiUIExtensionConstants
{
    /**
     * @param reference the reference of the document to update. Can be either local or absolute depending if the
     *            document is associated to a specific wiki or not
     */
    protected AbstractUIExtensionClassDocumentInitializer(EntityReference reference)
    {
        super(reference);
    }

    @Override
    protected void createClass(BaseClass xclass)
    {
        // The content property supports wiki syntax, but it uses script macros most of the time.
        xclass.addTextAreaField(CONTENT_PROPERTY, "Executed Content", 120, 25, EditorType.TEXT);

        super.createClass(xclass);
    }
}
